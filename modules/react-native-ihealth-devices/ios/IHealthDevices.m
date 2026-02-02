//
//  IHealthDevices.m
//  CareView
//
//  Native module for iHealth device integration + BLE GATT generic devices
//  
//  Supported iHealth SDK devices: BP3L, BP5, BP5S, HS2, HS2S, HS4S
//  Supported BLE GATT devices: Any device advertising BP (0x1810) or Scale (0x181D) service
//
//  BG5/BG5S glucose devices have been REMOVED - Dexcom API will be used instead
//

#import "IHealthDevices.h"
#import <CoreBluetooth/CoreBluetooth.h>
#import "Headers/IHSDKCloudUser.h"
#import "Headers/ScanDeviceController.h"
#import "Headers/ConnectDeviceController.h"
#import "Headers/HealthHeader.h"
#import "Headers/HealthUser.h"

// Blood Pressure (iHealth SDK)
#import "Headers/BP3L.h"
#import "Headers/BP3LController.h"
#import "Headers/BP5.h"
#import "Headers/BP5Controller.h"
#import "Headers/BP5S.h"
#import "Headers/BP5SController.h"
#import "Headers/BPMacroFile.h"

// Scales (iHealth SDK)
#import "Headers/HS2.h"
#import "Headers/HS2Controller.h"
#import "Headers/HS2S.h"
#import "Headers/HS2SController.h"
#import "Headers/HS4.h"
#import "Headers/HS4Controller.h"
#import "Headers/HSMacroFile.h"

// ============================================================================
// BLE GATT Service UUIDs (Bluetooth SIG Standard)
// ============================================================================
static NSString * const kBLEBloodPressureServiceUUID = @"1810";
static NSString * const kBLEWeightScaleServiceUUID = @"181D";

// Blood Pressure Characteristics
static NSString * const kBLEBPMeasurementCharUUID = @"2A35";    // Blood Pressure Measurement
static NSString * const kBLEBPFeatureCharUUID = @"2A49";        // Blood Pressure Feature

// Weight Scale Characteristics
static NSString * const kBLEWeightMeasurementCharUUID = @"2A9D"; // Weight Measurement
static NSString * const kBLEWeightFeatureCharUUID = @"2A9E";     // Weight Scale Feature

@interface IHealthDevices () <CBCentralManagerDelegate, CBPeripheralDelegate>
@end

@implementation IHealthDevices {
    BOOL _isAuthenticated;
    BOOL _hasListeners;
    BOOL _controllersInitialized;
    NSMutableDictionary *_connectedDevices;
    NSString *_targetMAC;
    NSString *_targetType;
    
    // CoreBluetooth for BLE GATT devices
    CBCentralManager *_centralManager;
    BOOL _isScanning;
    BOOL _scanningForGATT;
    NSMutableDictionary *_discoveredGATTDevices;
    NSMutableDictionary *_gattPeripherals;
    
    // Connected GATT peripheral tracking
    CBPeripheral *_connectedGATTPeripheral;
    NSString *_connectedGATTIdentifier;
    NSString *_connectedGATTType; // "BP" or "SCALE"
    
    // GATT characteristics
    CBCharacteristic *_bpMeasurementChar;
    CBCharacteristic *_weightMeasurementChar;
}

RCT_EXPORT_MODULE();

- (instancetype)init {
    self = [super init];
    if (self) {
        _isAuthenticated = NO;
        _controllersInitialized = NO;
        _connectedDevices = [NSMutableDictionary new];
        _discoveredGATTDevices = [NSMutableDictionary new];
        _gattPeripherals = [NSMutableDictionary new];
        _isScanning = NO;
        _scanningForGATT = NO;
        _connectedGATTPeripheral = nil;
        _connectedGATTIdentifier = nil;
        _connectedGATTType = nil;
        _bpMeasurementChar = nil;
        _weightMeasurementChar = nil;
        
        [self registerNotifications];
        
        // Initialize CoreBluetooth for GATT devices
        dispatch_queue_t btQueue = dispatch_queue_create("com.careview.bluetooth", DISPATCH_QUEUE_SERIAL);
        _centralManager = [[CBCentralManager alloc] initWithDelegate:self queue:btQueue options:@{
            CBCentralManagerOptionShowPowerAlertKey: @YES
        }];
    }
    return self;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
    if (_centralManager.isScanning) {
        [_centralManager stopScan];
    }
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"onDeviceFound", @"onConnectionStateChanged", @"onScanStateChanged",
             @"onBloodPressureReading", @"onWeightReading", @"onError", @"onDebugLog"];
}

- (void)startObserving { _hasListeners = YES; }
- (void)stopObserving { _hasListeners = NO; }

+ (BOOL)requiresMainQueueSetup {
    return YES;
}

#pragma mark - Logging

- (void)sendDebugLog:(NSString *)message {
    NSLog(@"iHealth: %@", message);
    if (_hasListeners) {
        [self sendEventWithName:@"onDebugLog" body:@{
            @"message": message,
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    }
}

- (void)sendEventSafe:(NSString *)name body:(id)body {
    if (_hasListeners) {
        [self sendEventWithName:name body:body];
    }
}

#pragma mark - CoreBluetooth Delegate (BLE GATT)

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    NSString *stateStr;
    switch (central.state) {
        case CBManagerStatePoweredOn: stateStr = @"PoweredOn"; break;
        case CBManagerStatePoweredOff: stateStr = @"PoweredOff"; break;
        case CBManagerStateUnauthorized: stateStr = @"Unauthorized"; break;
        case CBManagerStateUnsupported: stateStr = @"Unsupported"; break;
        case CBManagerStateResetting: stateStr = @"Resetting"; break;
        default: stateStr = @"Unknown"; break;
    }
    [self sendDebugLog:[NSString stringWithFormat:@"📱 CoreBluetooth state: %@", stateStr]];
    
    if (central.state == CBManagerStatePoweredOn && _scanningForGATT) {
        [self sendDebugLog:@"📱 BT ready, starting deferred GATT scan..."];
        [self startGATTScan];
    }
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *,id> *)advertisementData
                  RSSI:(NSNumber *)RSSI {
    
    NSString *localName = advertisementData[CBAdvertisementDataLocalNameKey] ?: @"";
    NSString *peripheralName = peripheral.name ?: @"";
    NSString *displayName = localName.length > 0 ? localName : peripheralName;
    NSString *identifier = peripheral.identifier.UUIDString;
    
    // Get advertised service UUIDs
    NSArray *serviceUUIDs = advertisementData[CBAdvertisementDataServiceUUIDsKey];
    
    BOOL isBPDevice = NO;
    BOOL isScaleDevice = NO;
    
    // Check advertised services for standard GATT profiles
    for (CBUUID *uuid in serviceUUIDs) {
        NSString *uuidStr = [uuid.UUIDString uppercaseString];
        if ([uuidStr isEqualToString:kBLEBloodPressureServiceUUID] || [uuidStr containsString:@"1810"]) {
            isBPDevice = YES;
        }
        if ([uuidStr isEqualToString:kBLEWeightScaleServiceUUID] || [uuidStr containsString:@"181D"]) {
            isScaleDevice = YES;
        }
    }
    
    // Skip if not a BP or Scale device
    if (!isBPDevice && !isScaleDevice) {
        return;
    }
    
    // Skip duplicates
    if (_discoveredGATTDevices[identifier]) {
        return;
    }
    
    NSString *deviceType = isBPDevice ? @"GATT_BP" : @"GATT_SCALE";
    NSString *categoryType = isBPDevice ? @"BP" : @"SCALE";
    
    _discoveredGATTDevices[identifier] = @{
        @"peripheral": peripheral,
        @"name": displayName,
        @"type": deviceType,
        @"category": categoryType,
        @"uuid": identifier
    };
    _gattPeripherals[identifier] = peripheral;
    
    [self sendDebugLog:[NSString stringWithFormat:@"📡 GATT %@ DISCOVERED: %@ (UUID: %@)", 
                       isBPDevice ? @"BP" : @"SCALE", displayName, identifier]];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventSafe:@"onDeviceFound" body:@{
            @"mac": identifier,
            @"name": displayName.length > 0 ? displayName : (isBPDevice ? @"BLE Blood Pressure" : @"BLE Scale"),
            @"type": deviceType,
            @"category": categoryType,
            @"rssi": RSSI,
            @"source": @"BLE_GATT"
        }];
    });
    
    // Auto-connect if this is our target
    if (self->_targetMAC && [self->_targetMAC isEqualToString:identifier]) {
        [self sendDebugLog:@"🎯 TARGET GATT DEVICE FOUND - auto-connecting..."];
        [self connectGATTPeripheral:peripheral identifier:identifier type:categoryType];
    }
}

- (void)startGATTScan {
    if (_centralManager.state != CBManagerStatePoweredOn) {
        [self sendDebugLog:@"📱 CoreBluetooth not ready, will scan when powered on"];
        _scanningForGATT = YES;
        return;
    }
    
    [self sendDebugLog:@"📡 Starting BLE GATT scan for BP (0x1810) and Scale (0x181D)..."];
    [_discoveredGATTDevices removeAllObjects];
    
    // Scan for BP and Scale services
    NSArray *services = @[
        [CBUUID UUIDWithString:kBLEBloodPressureServiceUUID],
        [CBUUID UUIDWithString:kBLEWeightScaleServiceUUID]
    ];
    
    [_centralManager scanForPeripheralsWithServices:services options:@{
        CBCentralManagerScanOptionAllowDuplicatesKey: @NO
    }];
    
    _isScanning = YES;
    _scanningForGATT = YES;
}

- (void)stopGATTScan {
    if (_centralManager.isScanning) {
        [_centralManager stopScan];
        [self sendDebugLog:@"📡 GATT scan stopped"];
    }
    _isScanning = NO;
    _scanningForGATT = NO;
}

#pragma mark - GATT Connection

- (void)connectGATTPeripheral:(CBPeripheral *)peripheral identifier:(NSString *)identifier type:(NSString *)type {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 GATT: Connecting to %@ (%@)...", identifier, type]];
    
    _connectedGATTIdentifier = identifier;
    _connectedGATTType = type;
    peripheral.delegate = self;
    [_centralManager connectPeripheral:peripheral options:nil];
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
    [self sendDebugLog:[NSString stringWithFormat:@"🔗 GATT CONNECTED: %@", peripheral.name]];
    
    _connectedGATTPeripheral = peripheral;
    [self stopGATTScan];
    
    // Discover services
    [self sendDebugLog:@"🔍 Discovering GATT services..."];
    NSArray *services = @[
        [CBUUID UUIDWithString:kBLEBloodPressureServiceUUID],
        [CBUUID UUIDWithString:kBLEWeightScaleServiceUUID]
    ];
    [peripheral discoverServices:services];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *identifier = self->_connectedGATTIdentifier ?: peripheral.identifier.UUIDString;
        NSString *type = self->_connectedGATTType ?: @"BP";
        
        self->_connectedDevices[identifier] = @{
            @"type": [NSString stringWithFormat:@"GATT_%@", type],
            @"mac": identifier,
            @"source": @"BLE_GATT"
        };
        
        [self sendEventSafe:@"onConnectionStateChanged" body:@{
            @"mac": identifier,
            @"type": [NSString stringWithFormat:@"GATT_%@", type],
            @"connected": @YES,
            @"source": @"BLE_GATT"
        }];
    });
}

- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    [self sendDebugLog:[NSString stringWithFormat:@"❌ GATT connection FAILED: %@", error.localizedDescription]];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventSafe:@"onError" body:@{
            @"mac": self->_connectedGATTIdentifier ?: @"",
            @"type": @"GATT",
            @"error": @(-1),
            @"message": error.localizedDescription ?: @"Connection failed"
        }];
    });
    
    _connectedGATTIdentifier = nil;
    _connectedGATTType = nil;
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 GATT DISCONNECTED: %@ (error: %@)", 
                       peripheral.name, error.localizedDescription ?: @"none"]];
    
    NSString *identifier = _connectedGATTIdentifier ?: peripheral.identifier.UUIDString;
    [_connectedDevices removeObjectForKey:identifier];
    
    _connectedGATTPeripheral = nil;
    _connectedGATTIdentifier = nil;
    _connectedGATTType = nil;
    _bpMeasurementChar = nil;
    _weightMeasurementChar = nil;
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventSafe:@"onConnectionStateChanged" body:@{
            @"mac": identifier,
            @"type": @"GATT",
            @"connected": @NO
        }];
    });
}

#pragma mark - CBPeripheralDelegate (GATT Service Discovery)

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ GATT service discovery error: %@", error.localizedDescription]];
        return;
    }
    
    [self sendDebugLog:[NSString stringWithFormat:@"🔍 GATT discovered %lu services", (unsigned long)peripheral.services.count]];
    
    for (CBService *service in peripheral.services) {
        [self sendDebugLog:[NSString stringWithFormat:@"   Service: %@", service.UUID]];
        [peripheral discoverCharacteristics:nil forService:service];
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ GATT characteristic discovery error: %@", error.localizedDescription]];
        return;
    }
    
    NSString *serviceUUID = [service.UUID.UUIDString uppercaseString];
    [self sendDebugLog:[NSString stringWithFormat:@"🔍 GATT service %@ has %lu characteristics", 
                       serviceUUID, (unsigned long)service.characteristics.count]];
    
    for (CBCharacteristic *characteristic in service.characteristics) {
        NSString *charUUID = [characteristic.UUID.UUIDString uppercaseString];
        [self sendDebugLog:[NSString stringWithFormat:@"   Char: %@ (props: %lu)", charUUID, (unsigned long)characteristic.properties]];
        
        // Blood Pressure Measurement
        if ([charUUID isEqualToString:kBLEBPMeasurementCharUUID] || [charUUID containsString:@"2A35"]) {
            _bpMeasurementChar = characteristic;
            [self sendDebugLog:@"   ✅ Found BP Measurement characteristic"];
            if (characteristic.properties & (CBCharacteristicPropertyIndicate | CBCharacteristicPropertyNotify)) {
                [peripheral setNotifyValue:YES forCharacteristic:characteristic];
            }
        }
        
        // Weight Measurement
        if ([charUUID isEqualToString:kBLEWeightMeasurementCharUUID] || [charUUID containsString:@"2A9D"]) {
            _weightMeasurementChar = characteristic;
            [self sendDebugLog:@"   ✅ Found Weight Measurement characteristic"];
            if (characteristic.properties & (CBCharacteristicPropertyIndicate | CBCharacteristicPropertyNotify)) {
                [peripheral setNotifyValue:YES forCharacteristic:characteristic];
            }
        }
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ GATT notification error: %@", error.localizedDescription]];
        return;
    }
    
    [self sendDebugLog:[NSString stringWithFormat:@"📡 GATT Notification %@ for %@", 
                       characteristic.isNotifying ? @"ON" : @"OFF", characteristic.UUID]];
    
    if (characteristic.isNotifying) {
        [self sendDebugLog:@"✅ GATT device READY - waiting for measurement..."];
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ GATT read error: %@", error.localizedDescription]];
        return;
    }
    
    NSData *data = characteristic.value;
    NSString *charUUID = [characteristic.UUID.UUIDString uppercaseString];
    
    if (!data || data.length == 0) return;
    
    [self sendDebugLog:[NSString stringWithFormat:@"📨 GATT RX from %@: %lu bytes", charUUID, (unsigned long)data.length]];
    
    // Parse Blood Pressure
    if ([charUUID isEqualToString:kBLEBPMeasurementCharUUID] || [charUUID containsString:@"2A35"]) {
        [self parseGATTBloodPressure:data];
    }
    
    // Parse Weight
    if ([charUUID isEqualToString:kBLEWeightMeasurementCharUUID] || [charUUID containsString:@"2A9D"]) {
        [self parseGATTWeight:data];
    }
}

#pragma mark - GATT Data Parsing

- (void)parseGATTBloodPressure:(NSData *)data {
    if (data.length < 7) {
        [self sendDebugLog:@"⚠️ BP data too short"];
        return;
    }
    
    const uint8_t *bytes = data.bytes;
    uint8_t flags = bytes[0];
    
    BOOL isKPa = (flags & 0x01) != 0;
    
    float systolic = [self parseSFLOAT:&bytes[1]];
    float diastolic = [self parseSFLOAT:&bytes[3]];
    
    if (isKPa) {
        systolic *= 7.50062;
        diastolic *= 7.50062;
    }
    
    int pulseRate = 0;
    int offset = 7;
    
    if (flags & 0x02) offset += 7; // Skip timestamp
    if ((flags & 0x04) && data.length >= offset + 2) {
        pulseRate = (int)[self parseSFLOAT:&bytes[offset]];
    }
    
    [self sendDebugLog:[NSString stringWithFormat:@"🎉 GATT BP: %d/%d mmHg, pulse=%d", (int)systolic, (int)diastolic, pulseRate]];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": self->_connectedGATTIdentifier ?: @"",
            @"type": @"GATT_BP",
            @"systolic": @((int)systolic),
            @"diastolic": @((int)diastolic),
            @"pulse": @(pulseRate),
            @"irregular": @NO,
            @"source": @"BLE_GATT",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    });
}

- (void)parseGATTWeight:(NSData *)data {
    if (data.length < 3) {
        [self sendDebugLog:@"⚠️ Weight data too short"];
        return;
    }
    
    const uint8_t *bytes = data.bytes;
    uint8_t flags = bytes[0];
    
    BOOL isImperial = (flags & 0x01) != 0;
    uint16_t rawWeight = bytes[1] | (bytes[2] << 8);
    
    float weight;
    NSString *unit;
    
    if (isImperial) {
        weight = rawWeight * 0.01;
        unit = @"lbs";
    } else {
        weight = rawWeight * 0.005;
        unit = @"kg";
    }
    
    [self sendDebugLog:[NSString stringWithFormat:@"🎉 GATT Weight: %.1f %@", weight, unit]];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventSafe:@"onWeightReading" body:@{
            @"mac": self->_connectedGATTIdentifier ?: @"",
            @"type": @"GATT_SCALE",
            @"weight": @(weight),
            @"unit": unit,
            @"source": @"BLE_GATT",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    });
}

- (float)parseSFLOAT:(const uint8_t *)bytes {
    int16_t raw = bytes[0] | (bytes[1] << 8);
    int16_t mantissa = raw & 0x0FFF;
    int8_t exponent = (raw >> 12) & 0x0F;
    
    if (mantissa & 0x0800) mantissa |= 0xF000;
    if (exponent & 0x08) exponent |= 0xF0;
    
    return (float)mantissa * powf(10.0f, (float)exponent);
}

#pragma mark - Controller Initialization

- (void)initializeControllers {
    if (_controllersInitialized) {
        [self sendDebugLog:@"🎮 Controllers already initialized"];
        return;
    }
    
    [self sendDebugLog:@"🎮 Initializing device controllers..."];
    
    [BP3LController shareBP3LController];
    [BP5Controller shareBP5Controller];
    [BP5SController sharedController];
    [HS2Controller shareIHHs2Controller];
    [HS2SController shareIHHS2SController];
    [HS4Controller shareIHHs4Controller];
    
    _controllersInitialized = YES;
    [self sendDebugLog:@"🎮 All controllers initialized!"];
}

#pragma mark - Device Retrieval

- (BP3L *)getBP3LWithMac:(NSString *)mac {
    NSArray *devices = [[BP3LController shareBP3LController] getAllCurrentBP3LInstace];
    for (BP3L *d in devices) if ([mac isEqualToString:d.serialNumber]) return d;
    return nil;
}

- (BP5 *)getBP5WithMac:(NSString *)mac {
    NSArray *devices = [[BP5Controller shareBP5Controller] getAllCurrentBP5Instace];
    for (BP5 *d in devices) if ([mac isEqualToString:d.serialNumber]) return d;
    return nil;
}

- (BP5S *)getBP5SWithMac:(NSString *)mac {
    NSArray *devices = [[BP5SController sharedController] getAllCurrentInstance];
    for (BP5S *d in devices) if ([mac isEqualToString:d.serialNumber]) return d;
    return nil;
}

- (HS2 *)getHS2WithMac:(NSString *)mac {
    NSArray *devices = [[HS2Controller shareIHHs2Controller] getAllCurrentHS2Instace];
    for (HS2 *d in devices) if ([mac isEqualToString:d.deviceID]) return d;
    return nil;
}

- (HS2S *)getHS2SWithMac:(NSString *)mac {
    NSArray *devices = [[HS2SController shareIHHS2SController] getAllCurrentHS2SInstace];
    for (HS2S *d in devices) if ([mac isEqualToString:d.serialNumber]) return d;
    return nil;
}

- (HS4 *)getHS4WithMac:(NSString *)mac {
    NSArray *devices = [[HS4Controller shareIHHs4Controller] getAllCurrentHS4Instace];
    for (HS4 *d in devices) if ([mac isEqualToString:d.deviceID]) return d;
    return nil;
}

#pragma mark - Notifications

- (void)registerNotifications {
    NSNotificationCenter *center = [NSNotificationCenter defaultCenter];

    // BP3L
    [center addObserver:self selector:@selector(onDiscover:) name:@"BP3LDiscover" object:nil];
    [center addObserver:self selector:@selector(onConnected:) name:@"BP3LConnectNoti" object:nil];
    [center addObserver:self selector:@selector(onDisconnected:) name:@"BP3LDisConnectNoti" object:nil];

    // BP5
    [center addObserver:self selector:@selector(onDiscover:) name:@"BP5Discover" object:nil];
    [center addObserver:self selector:@selector(onConnected:) name:@"BP5ConnectNoti" object:nil];
    [center addObserver:self selector:@selector(onDisconnected:) name:@"BP5DisConnectNoti" object:nil];
    
    // BP5S
    [center addObserver:self selector:@selector(onDiscover:) name:@"BP5SDiscover" object:nil];
    [center addObserver:self selector:@selector(onConnected:) name:@"BP5SConnectNoti" object:nil];
    [center addObserver:self selector:@selector(onDisconnected:) name:@"BP5SDisConnectNoti" object:nil];

    // HS2
    [center addObserver:self selector:@selector(onDiscover:) name:@"HS2Discover" object:nil];
    [center addObserver:self selector:@selector(onConnected:) name:@"HS2ConnectNoti" object:nil];
    [center addObserver:self selector:@selector(onDisconnected:) name:@"HS2DisConnectNoti" object:nil];

    // HS2S
    [center addObserver:self selector:@selector(onDiscover:) name:@"HS2SDiscover" object:nil];
    [center addObserver:self selector:@selector(onConnected:) name:@"HS2SConnectNoti" object:nil];
    [center addObserver:self selector:@selector(onDisconnected:) name:@"HS2SDisConnectNoti" object:nil];

    // HS4 (HS4S)
    [center addObserver:self selector:@selector(onDiscover:) name:@"HS4Discover" object:nil];
    [center addObserver:self selector:@selector(onConnected:) name:@"HS4ConnectNoti" object:nil];
    [center addObserver:self selector:@selector(onDisconnected:) name:@"HS4DisConnectNoti" object:nil];

    [self sendDebugLog:@"📡 Notification observers registered"];
}

- (NSString *)typeFromName:(NSString *)name {
    if ([name containsString:@"BP3L"]) return @"BP3L";
    if ([name containsString:@"BP5S"]) return @"BP5S";
    if ([name containsString:@"BP5"]) return @"BP5";
    if ([name containsString:@"HS2S"]) return @"HS2S";
    if ([name containsString:@"HS2"]) return @"HS2";
    if ([name containsString:@"HS4"]) return @"HS4S";
    return @"Unknown";
}

- (NSString *)getMacFromNotification:(NSNotification *)notification forType:(NSString *)type {
    NSDictionary *info = notification.userInfo;
    if ([type isEqualToString:@"HS2"] || [type isEqualToString:@"HS4S"]) {
        return info[@"DeviceID"] ?: info[@"ID"] ?: info[@"SerialNumber"] ?: @"";
    }
    return info[@"SerialNumber"] ?: info[@"ID"] ?: info[@"DeviceID"] ?: @"";
}

#pragma mark - Discovery Handler

- (void)onDiscover:(NSNotification *)notification {
    NSDictionary *info = notification.userInfo;
    NSString *type = [self typeFromName:notification.name];
    NSString *mac = [self getMacFromNotification:notification forType:type];

    [self sendDebugLog:[NSString stringWithFormat:@"📡 SDK DISCOVERED: %@ (%@)", mac, type]];

    [self sendEventSafe:@"onDeviceFound" body:@{
        @"mac": mac,
        @"name": info[@"DeviceName"] ?: type,
        @"type": type,
        @"rssi": info[@"RSSI"] ?: @(-50),
        @"source": @"iHealthSDK"
    }];

    if (_targetMAC && [[mac uppercaseString] isEqualToString:[_targetMAC uppercaseString]]) {
        [self sendDebugLog:@"🎯 TARGET FOUND - connecting..."];
        ConnectDeviceController *connector = [ConnectDeviceController commandGetInstance];
        [connector commandContectDeviceWithDeviceType:[self deviceTypeFromString:type] andSerialNub:mac];
    }
}

#pragma mark - Connection Handler

- (void)onConnected:(NSNotification *)notification {
    NSDictionary *info = notification.userInfo;
    NSString *type = [self typeFromName:notification.name];
    NSString *mac = [self getMacFromNotification:notification forType:type];

    [self sendDebugLog:[NSString stringWithFormat:@"🔗 SDK CONNECTED: %@ (%@)", mac, type]];

    _connectedDevices[mac] = @{@"type": type, @"mac": mac, @"source": @"iHealthSDK"};
    _targetMAC = nil;
    _targetType = nil;

    [self sendEventSafe:@"onConnectionStateChanged" body:@{
        @"mac": mac,
        @"type": type,
        @"connected": @YES,
        @"source": @"iHealthSDK"
    }];

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if ([type isEqualToString:@"BP3L"]) {
            BP3L *d = [self getBP3LWithMac:mac];
            if (d) [self handleBP3LConnected:d mac:mac];
        } else if ([type isEqualToString:@"BP5"]) {
            BP5 *d = [self getBP5WithMac:mac];
            if (d) [self handleBP5Connected:d mac:mac];
        } else if ([type isEqualToString:@"BP5S"]) {
            BP5S *d = [self getBP5SWithMac:mac];
            if (d) [self handleBP5SConnected:d mac:mac];
        } else if ([type isEqualToString:@"HS2"]) {
            HS2 *d = [self getHS2WithMac:mac];
            if (d) [self handleHS2Connected:d mac:mac];
        } else if ([type isEqualToString:@"HS2S"]) {
            HS2S *d = [self getHS2SWithMac:mac];
            if (d) [self handleHS2SConnected:d mac:mac];
        } else if ([type isEqualToString:@"HS4S"]) {
            HS4 *d = [self getHS4WithMac:mac];
            if (d) [self handleHS4Connected:d mac:mac];
        }
    });
}

- (void)onDisconnected:(NSNotification *)notification {
    NSString *type = [self typeFromName:notification.name];
    NSString *mac = [self getMacFromNotification:notification forType:type];
    
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 DISCONNECTED: %@ (%@)", mac, type]];
    [_connectedDevices removeObjectForKey:mac];
    
    [self sendEventSafe:@"onConnectionStateChanged" body:@{@"mac": mac, @"type": type, @"connected": @NO}];
}

#pragma mark - SDK Device Disconnect (matches old working pattern)

/**
 * Disconnect an iHealth SDK device by calling commandDisconnectDevice
 * directly on the device object retrieved from its controller.
 *
 * This is the pattern that worked in the original version. The SDK manages
 * its own CBCentralManager internally, so our _centralManager cannot
 * disconnect SDK devices — we must call the device's own disconnect method.
 */
- (void)disconnectSDKDevice:(NSString *)mac type:(NSString *)type {
    if (!mac || !type) return;
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 SDK disconnect: %@ (%@)", mac, type]];
    
    @try {
        // Only these three have commandDisconnectDevice in the SDK.
        // BP5, HS2S, HS4S auto-disconnect when BLE drops — no explicit method.
        if ([type isEqualToString:@"BP3L"]) {
            BP3L *device = [self getBP3LWithMac:mac];
            if (device) {
                [device commandDisconnectDevice];
                [self sendDebugLog:@"🔌 BP3L commandDisconnectDevice called"];
            }
        }
        else if ([type isEqualToString:@"BP5S"]) {
            BP5S *device = [self getBP5SWithMac:mac];
            if (device) {
                [device commandDisconnectDevice];
                [self sendDebugLog:@"🔌 BP5S commandDisconnectDevice called"];
            }
        }
        else if ([type isEqualToString:@"HS2"]) {
            HS2 *device = [self getHS2WithMac:mac];
            if (device) {
                [device commandDisconnectDevice];
                [self sendDebugLog:@"🔌 HS2 commandDisconnectDevice called"];
            }
        }
        else {
            [self sendDebugLog:[NSString stringWithFormat:@"🔌 No explicit disconnect for %@ — will auto-disconnect", type]];
        }
    } @catch (NSException *e) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚠️ SDK disconnect exception for %@: %@", type, e.reason]];
    }
}

#pragma mark - BP Handlers

- (void)handleBP3LConnected:(BP3L *)bp mac:(NSString *)mac {
    [self sendDebugLog:@"🩺 BP3L: Starting measurement..."];
    [bp commandStartMeasureWithZeroingState:^(BOOL c){} pressure:^(NSArray *p){} waveletWithHeartbeat:^(NSArray *w){} waveletWithoutHeartbeat:^(NSArray *w){} result:^(NSDictionary *r) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BP3L RESULT: %@", r]];
        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": mac, @"type": @"BP3L",
            @"systolic": r[@"sys"] ?: @0, @"diastolic": r[@"dia"] ?: @0,
            @"pulse": r[@"heartRate"] ?: @0, @"irregular": r[@"irregular"] ?: @NO,
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } errorBlock:^(BPDeviceError e) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ BP3L error: %d", (int)e]];
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BP3L", @"error": @(e)}];
    }];
}

- (void)handleBP5Connected:(BP5 *)bp mac:(NSString *)mac {
    [self sendDebugLog:@"🩺 BP5: Starting measurement..."];
    [bp commandStartMeasureWithZeroingState:^(BOOL c){} pressure:^(NSArray *p){} waveletWithHeartbeat:^(NSArray *w){} waveletWithoutHeartbeat:^(NSArray *w){} result:^(NSDictionary *r) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BP5 RESULT: %@", r]];
        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": mac, @"type": @"BP5",
            @"systolic": r[@"sys"] ?: @0, @"diastolic": r[@"dia"] ?: @0,
            @"pulse": r[@"heartRate"] ?: @0, @"irregular": r[@"irregular"] ?: @NO,
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } errorBlock:^(BPDeviceError e) {
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BP5", @"error": @(e)}];
    }];
}

- (void)handleBP5SConnected:(BP5S *)bp mac:(NSString *)mac {
    [self sendDebugLog:@"🩺 BP5S: Starting measurement..."];
    [bp commandStartMeasureWithZeroingState:^(BOOL c){} pressure:^(NSArray *p){} waveletWithHeartbeat:^(NSArray *w){} waveletWithoutHeartbeat:^(NSArray *w){} result:^(NSDictionary *r) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BP5S RESULT: %@", r]];
        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": mac, @"type": @"BP5S",
            @"systolic": r[@"sys"] ?: @0, @"diastolic": r[@"dia"] ?: @0,
            @"pulse": r[@"heartRate"] ?: @0, @"irregular": r[@"irregular"] ?: @NO,
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } errorBlock:^(BPDeviceError e) {
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BP5S", @"error": @(e)}];
    }];
}

#pragma mark - Scale Handlers

- (void)handleHS2Connected:(HS2 *)scale mac:(NSString *)mac {
    [self sendDebugLog:@"⚖️ HS2: Starting measurement..."];
    [scale commandHS2MeasureWithUint:HSUnit_Kg Weight:^(NSNumber *w){} StableWeight:^(NSDictionary *r) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 HS2 STABLE: %@", r]];
        [self sendEventSafe:@"onWeightReading" body:@{
            @"mac": mac, @"type": @"HS2", @"weight": r[@"Weight"] ?: @0, @"unit": @"kg",
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } DisposeErrorBlock:^(HS2DeviceError e) {
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"HS2", @"error": @(e)}];
    }];
}

- (void)handleHS2SConnected:(HS2S *)scale mac:(NSString *)mac {
    [self sendDebugLog:@"⚖️ HS2S: Starting measurement..."];
    
    HealthUser *user = [[HealthUser alloc] init];
    user.userType = UserType_Guest;
    user.height = @170; user.weight = @70; user.age = @30;
    user.sex = UserSex_Male;
    user.impedanceMark = HS2SImpedanceMark_NO;

    [scale commandStartHS2SMeasureWithUser:user weight:^(NSNumber *w){} stableWeight:^(NSNumber *w) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 HS2S STABLE: %@", w]];
        [self sendEventSafe:@"onWeightReading" body:@{
            @"mac": mac, @"type": @"HS2S", @"weight": w ?: @0, @"unit": @"kg",
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } weightAndBodyInfo:^(NSDictionary *info) {
        NSNumber *weight = info[@"HS2SWeigthResult"] ?: @0;
        [self sendEventSafe:@"onWeightReading" body:@{
            @"mac": mac, @"type": @"HS2S", @"weight": weight, @"unit": @"kg",
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } disposeHS2SMeasureFinish:^{} DiaposeErrorBlock:^(HS2SDeviceError e) {
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"HS2S", @"error": @(e)}];
    }];
}

- (void)handleHS4Connected:(HS4 *)scale mac:(NSString *)mac {
    [self sendDebugLog:@"⚖️ HS4S: Starting measurement..."];
    [scale commandMeasureWithUint:1 Weight:^(NSNumber *w){} StableWeight:^(NSDictionary *r) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 HS4S STABLE: %@", r]];
        [self sendEventSafe:@"onWeightReading" body:@{
            @"mac": mac, @"type": @"HS4S", @"weight": r[@"Weight"] ?: @0, @"unit": @"kg",
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } DisposeErrorBlock:^(HS4DeviceError e) {
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"HS4S", @"error": @(e)}];
    }];
}

#pragma mark - RCT Methods

RCT_EXPORT_METHOD(authenticate:(NSString *)licensePath resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:@"🔑 Auth: Starting..."];
    NSString *path = [[NSBundle mainBundle] pathForResource:@"license" ofType:@"pem"];
    if (!path) { reject(@"NO_LICENSE", @"license.pem not found", nil); return; }
    
    NSData *licenseData = [NSData dataWithContentsOfFile:path];
    [[IHSDKCloudUser commandGetSDKUserInstance] commandSDKUserValidationWithLicense:licenseData
        UserDeviceAccess:^(NSArray *d){}
        UserValidationSuccess:^(UserAuthenResult r) {
            self->_isAuthenticated = YES;
            [self initializeControllers];
            resolve(@YES);
        }
        DisposeErrorBlock:^(UserAuthenResult e) {
            self->_isAuthenticated = YES;
            [self initializeControllers];
            resolve(@YES);
        }];
}

RCT_EXPORT_METHOD(isAuthenticated:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(@(_isAuthenticated));
}

RCT_EXPORT_METHOD(startScan:(NSArray *)deviceTypes resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"📶 Scan: Starting for %@", deviceTypes]];
    if (!_controllersInitialized) [self initializeControllers];

    ScanDeviceController *scanner = [ScanDeviceController commandGetInstance];
    for (NSString *type in deviceTypes) {
        if ([type hasPrefix:@"BP"] || [type hasPrefix:@"HS"]) {
            [scanner commandScanDeviceType:[self deviceTypeFromString:type]];
        }
    }

    [self startGATTScan];
    [self sendEventSafe:@"onScanStateChanged" body:@{@"scanning": @YES}];
    resolve(nil);
}

RCT_EXPORT_METHOD(stopScan:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self stopGATTScan];
    ScanDeviceController *scanner = [ScanDeviceController commandGetInstance];
    [scanner commandStopScanDeviceType:HealthDeviceType_BP3L];
    [scanner commandStopScanDeviceType:HealthDeviceType_BP5];
    [scanner commandStopScanDeviceType:HealthDeviceType_BP5S];
    [scanner commandStopScanDeviceType:HealthDeviceType_HS2];
    [scanner commandStopScanDeviceType:HealthDeviceType_HS2S];
    [scanner commandStopScanDeviceType:HealthDeviceType_HS4];
    [self sendEventSafe:@"onScanStateChanged" body:@{@"scanning": @NO}];
    resolve(nil);
}

RCT_EXPORT_METHOD(connectDevice:(NSString *)mac deviceType:(NSString *)deviceType resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 Connect: %@ (%@)", mac, deviceType]];
    _targetMAC = mac;
    _targetType = deviceType;

    if ([deviceType hasPrefix:@"GATT_"]) {
        CBPeripheral *p = _gattPeripherals[mac];
        if (p) {
            [self connectGATTPeripheral:p identifier:mac type:[deviceType stringByReplacingOccurrencesOfString:@"GATT_" withString:@""]];
        } else {
            _scanningForGATT = YES;
            [self startGATTScan];
        }
        resolve(@YES);
        return;
    }

    int result = [[ConnectDeviceController commandGetInstance] commandContectDeviceWithDeviceType:[self deviceTypeFromString:deviceType] andSerialNub:mac];
    resolve(result == 1 ? @YES : @NO);
}

RCT_EXPORT_METHOD(disconnectDevice:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 Disconnect: %@", mac]];
    
    NSDictionary *info = _connectedDevices[mac];
    NSString *source = info[@"source"];
    NSString *type = info[@"type"];
    
    if ([source isEqualToString:@"BLE_GATT"] && _connectedGATTPeripheral) {
        [_centralManager cancelPeripheralConnection:_connectedGATTPeripheral];
    } else {
        // iHealth SDK devices — call commandDisconnectDevice directly on the device object
        [self disconnectSDKDevice:mac type:type];
    }
    
    [_connectedDevices removeObjectForKey:mac];
    resolve(nil);
}

RCT_EXPORT_METHOD(disconnectAll:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:@"🔌 Disconnect: All devices"];
    
    // Disconnect GATT devices
    if (_connectedGATTPeripheral) {
        [_centralManager cancelPeripheralConnection:_connectedGATTPeripheral];
        _connectedGATTPeripheral = nil;
    }
    
    // Disconnect iHealth SDK devices by calling commandDisconnectDevice
    // directly on each device object (this is how the old working version did it)
    NSDictionary *snapshot = [_connectedDevices copy];
    for (NSString *mac in snapshot) {
        NSDictionary *info = snapshot[mac];
        NSString *source = info[@"source"];
        NSString *type = info[@"type"];
        if (![source isEqualToString:@"BLE_GATT"]) {
            [self disconnectSDKDevice:mac type:type];
        }
    }
    
    [_connectedDevices removeAllObjects];
    _targetMAC = nil;
    _connectedGATTIdentifier = nil;
    _connectedGATTType = nil;
    _bpMeasurementChar = nil;
    _weightMeasurementChar = nil;
    
    resolve(nil);
}

RCT_EXPORT_METHOD(startMeasurement:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(nil);
}

RCT_EXPORT_METHOD(stopMeasurement:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(nil);
}

RCT_EXPORT_METHOD(getConnectedDevices:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    NSMutableArray *devices = [NSMutableArray new];
    for (NSString *mac in _connectedDevices) {
        NSDictionary *info = _connectedDevices[mac];
        [devices addObject:@{@"mac": mac, @"type": info[@"type"] ?: @"Unknown", @"source": info[@"source"] ?: @"unknown"}];
    }
    resolve(devices);
}

RCT_EXPORT_METHOD(getBatteryLevel:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(@(-1));
}

- (HealthDeviceType)deviceTypeFromString:(NSString *)type {
    if ([type isEqualToString:@"BP3L"]) return HealthDeviceType_BP3L;
    if ([type isEqualToString:@"BP5"]) return HealthDeviceType_BP5;
    if ([type isEqualToString:@"BP5S"]) return HealthDeviceType_BP5S;
    if ([type isEqualToString:@"HS2"]) return HealthDeviceType_HS2;
    if ([type isEqualToString:@"HS2S"]) return HealthDeviceType_HS2S;
    if ([type isEqualToString:@"HS4S"]) return HealthDeviceType_HS4;
    return HealthDeviceType_BP3L;
}

@end
//
//  IHealthDevices.m
//  CareView
//
//  Native module for iHealth device integration + BLE GATT generic devices
//  
//  Supported iHealth SDK devices: BP3L, BP5, BP5S, HS2, HS2S, HS4S
//  Supported BLE GATT devices: Any device advertising BP (0x1810) or Scale (0x181D) service
//
//  BG5S glucose support is SDK-only and uses stored-record reads.
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

// Glucose meter (iHealth SDK only, used by the TestFlight diagnostic screen)
#import "Headers/BG5S.h"
#import "Headers/BG5SController.h"
#import "Headers/BGMacroFile.h"

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

// Date Time lives INSIDE the Blood Pressure service on A&D monitors (not in a
// separate Current Time Service). Writing it is what makes the device include a
// timestamp in each measurement. A&D's own iOS sample never writes it, and its
// parser has an explicit "if time has not been set" branch where the timestamp
// bytes are absent and pulse shifts from byte 14 down to byte 7. Because CareView
// collects readings after the fact (store-and-forward), an undated reading would
// be stamped with collection time — wrong in the chart and bad for server dedup.
// So we write it once at pairing.
static NSString * const kBLEDateTimeCharUUID = @"2A08";

// Device Information — System ID carries the real 48-bit MAC. iOS never exposes
// a peripheral's MAC (only a per-install CoreBluetooth UUID), so this is the only
// way an iPhone and an Android phone can agree on one identity for the same
// physical cuff. Without it the same device registers as two EMR inventory units.
static NSString * const kBLEDeviceInfoServiceUUID = @"180A";
static NSString * const kBLESystemIDCharUUID = @"2A23";
static NSString * const kBLESerialNumberCharUUID = @"2A25";
static NSString * const kBLEModelNumberCharUUID = @"2A24";

// Battery
static NSString * const kBLEBatteryServiceUUID = @"180F";
static NSString * const kBLEBatteryLevelCharUUID = @"2A19";

@interface IHealthDevices () <CBCentralManagerDelegate, CBPeripheralDelegate, BG5SDelegate>
@end

@implementation IHealthDevices {
    BOOL _isAuthenticated;
    BOOL _hasListeners;
    BOOL _controllersInitialized;
    NSMutableDictionary *_connectedDevices;
    NSString *_targetMAC;
    NSString *_targetType;

    // Set by connectForBattery: connect → read battery → disconnect,
    // WITHOUT auto-starting a measurement. Cleared once consumed.
    NSString *_batteryOnlyMAC;
    
    // CoreBluetooth for BLE GATT devices
    CBCentralManager *_centralManager;
    BOOL _isScanning;
    BOOL _scanningForGATT;
    NSMutableDictionary *_discoveredGATTDevices;
    NSMutableDictionary *_gattPeripherals;
    NSString *_bg5sDebugMac;
    
    // Connected GATT peripheral tracking
    CBPeripheral *_connectedGATTPeripheral;
    NSString *_connectedGATTIdentifier;
    NSString *_connectedGATTType; // "BP" or "SCALE"
    
    // GATT characteristics
    CBCharacteristic *_bpMeasurementChar;
    CBCharacteristic *_weightMeasurementChar;

    // ---- Generic BLE (A&D UA-651BLE and other standard BP/scale profiles) ----
    // All state below is used ONLY by the ble* methods. The iHealth SDK paths
    // never read or write it.
    //
    // Peripherals we have an outstanding connectPeripheral: request for. iOS
    // holds such a request indefinitely with no timeout and does not touch the
    // device until it advertises, so the cuff's own 1-minute power-off timer
    // never starts early. This is what lets the capture screen "arm and wait".
    NSMutableDictionary<NSString *, CBPeripheral *> *_bleArmedPeripherals;

    // Identifiers currently in the bond-and-provision flow (Add Device). These
    // get the time write + device-info reads, then disconnect. Capture sessions
    // are NOT in this set and are left connected to receive the full batch.
    NSMutableSet<NSString *> *_bleBondingIdentifiers;

    // Per-identifier scratch for device info gathered across several async reads,
    // flushed to JS as one onBleDeviceInfo event once the reads settle.
    NSMutableDictionary<NSString *, NSMutableDictionary *> *_bleDeviceInfo;
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
        _bleArmedPeripherals = [NSMutableDictionary new];
        _bleBondingIdentifiers = [NSMutableSet new];
        _bleDeviceInfo = [NSMutableDictionary new];

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
             @"onBloodPressureReading", @"onWeightReading", @"onBloodGlucoseReading",
             @"onGlucoseMeterEvent", @"onBluetoothStateChanged", @"onError", @"onDebugLog",
             @"onBatteryLevel", @"onBleDeviceInfo"];
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

// Emit a battery level (0–100) read from the iHealth SDK. Best-effort: a nil
// or out-of-range value is ignored so we never report a bogus level.
- (void)emitBatteryForMac:(NSString *)mac type:(NSString *)type level:(NSNumber *)level {
    if (level == nil) return;
    int pct = [level intValue];
    if (pct < 0 || pct > 100) {
        [self sendDebugLog:[NSString stringWithFormat:@"🔋 %@ battery out of range: %@", type, level]];
        return;
    }
    [self sendDebugLog:[NSString stringWithFormat:@"🔋 %@ battery: %d%%", type, pct]];
    [self sendEventSafe:@"onBatteryLevel" body:@{
        @"mac": mac ?: @"",
        @"type": type ?: @"",
        @"level": @(pct),
        @"source": @"iHealthSDK",
        @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
    }];
}

// Battery-only connection path (connectForBattery): query the battery for
// the given type, emit it, then always disconnect. Never starts a
// measurement — this is what makes it safe to call from the add-device
// flow (the normal connect path auto-inflates BP cuffs).
- (void)queryBatteryOnly:(NSString *)mac type:(NSString *)type {
    void (^done)(void) = ^{
        // Small delay so the SDK finishes the command round-trip cleanly.
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [self sendDebugLog:[NSString stringWithFormat:@"🔋 Battery-only done — disconnecting %@", mac]];
            [self disconnectSDKDevice:mac type:type];
        });
    };

    if ([type isEqualToString:@"BP3L"]) {
        BP3L *d = [self getBP3LWithMac:mac];
        if (!d) { done(); return; }
        [d commandEnergy:^(NSNumber *energyValue) {
            [self emitBatteryForMac:mac type:type level:energyValue];
            done();
        } errorBlock:^(BPDeviceError e) { done(); }];
    } else if ([type isEqualToString:@"BP5"]) {
        BP5 *d = [self getBP5WithMac:mac];
        if (!d) { done(); return; }
        [d commandEnergy:^(NSNumber *energyValue) {
            [self emitBatteryForMac:mac type:type level:energyValue];
            done();
        } errorBlock:^(BPDeviceError e) { done(); }];
    } else if ([type isEqualToString:@"BP5S"]) {
        BP5S *d = [self getBP5SWithMac:mac];
        if (!d) { done(); return; }
        [d commandEnergy:^(NSNumber *energyValue) {
            [self emitBatteryForMac:mac type:type level:energyValue];
            done();
        } energyState:^(NSNumber *energyState){} errorBlock:^(BPDeviceError e) { done(); }];
    } else if ([type isEqualToString:@"HS2"]) {
        HS2 *d = [self getHS2WithMac:mac];
        if (!d) { done(); return; }
        [d commandGetHS2Battery:^(NSNumber *battary) {
            [self emitBatteryForMac:mac type:type level:battary];
            done();
        } DiaposeErrorBlock:^(HS2DeviceError e) { done(); }];
    } else if ([type isEqualToString:@"HS2S"]) {
        HS2S *d = [self getHS2SWithMac:mac];
        if (!d) { done(); return; }
        [d commandGetHS2SBattery:^(NSNumber *battary) {
            [self emitBatteryForMac:mac type:type level:battary];
            done();
        } DiaposeErrorBlock:^(HS2SDeviceError e) { done(); }];
    } else if ([type isEqualToString:@"BG5S"]) {
        BG5S *d = [self getBG5SWithMac:mac];
        if (!d) { done(); return; }
        [d queryStateInfoWithSuccess:^(BG5SStateInfo *stateInfo) {
            [self emitBatteryForMac:mac type:type level:@(stateInfo.batteryValue)];
            done();
        } errorBlock:^(BG5SError error, NSString *detailInfo) { done(); }];
    } else {
        // HS4S and unknown types have no battery API.
        done();
    }
}

- (NSDictionary *)bluetoothStatusPayload {
    CBManagerState state = _centralManager ? _centralManager.state : CBManagerStateUnknown;
    NSString *stateStr;
    NSString *message;
    switch (state) {
        case CBManagerStatePoweredOn:
            stateStr = @"powered_on";
            message = @"Bluetooth is ready.";
            break;
        case CBManagerStatePoweredOff:
            stateStr = @"powered_off";
            message = @"Bluetooth is off. Turn on Bluetooth, then try again.";
            break;
        case CBManagerStateUnauthorized:
            stateStr = @"unauthorized";
            message = @"Bluetooth permission is off for CareView. Allow Bluetooth in Settings, then try again.";
            break;
        case CBManagerStateUnsupported:
            stateStr = @"unsupported";
            message = @"This device does not support Bluetooth scanning.";
            break;
        case CBManagerStateResetting:
            stateStr = @"resetting";
            message = @"Bluetooth is resetting. Try again in a moment.";
            break;
        default:
            stateStr = @"unknown";
            message = @"Bluetooth is getting ready. Try again in a moment.";
            break;
    }

    BOOL available = state != CBManagerStateUnsupported;
    BOOL authorized = state != CBManagerStateUnauthorized;
    BOOL poweredOn = state == CBManagerStatePoweredOn;
    BOOL ready = available && authorized && poweredOn;

    return @{
        @"available": @(available),
        @"authorized": @(authorized),
        @"poweredOn": @(poweredOn),
        @"locationServicesEnabled": @YES,
        @"ready": @(ready),
        @"state": stateStr,
        @"message": message
    };
}

- (void)sendBG5SEvent:(NSString *)stage mac:(NSString *)mac message:(NSString *)message extra:(NSDictionary *)extra {
    NSMutableDictionary *body = [@{
        @"stage": stage ?: @"unknown",
        @"mac": mac ?: @"",
        @"type": @"BG5S",
        @"message": message ?: @"",
        @"source": @"iHealthSDK",
        @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
    } mutableCopy];
    if (extra) {
        [body addEntriesFromDictionary:extra];
    }

    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendDebugLog:[NSString stringWithFormat:@"BG5S %@: %@", stage ?: @"event", message ?: @""]];
        [self sendEventSafe:@"onGlucoseMeterEvent" body:body];
    });
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
    [self sendEventSafe:@"onBluetoothStateChanged" body:[self bluetoothStatusPayload]];

    if (central.state == CBManagerStatePoweredOff && (_isScanning || _scanningForGATT)) {
        [self sendEventSafe:@"onError" body:@{
            @"code": @"BLUETOOTH_OFF",
            @"message": @"Bluetooth is off. Turn on Bluetooth, then try again."
        }];
    } else if (central.state == CBManagerStateUnauthorized && (_isScanning || _scanningForGATT)) {
        [self sendEventSafe:@"onError" body:@{
            @"code": @"BLUETOOTH_UNAUTHORIZED",
            @"message": @"Bluetooth permission is off for CareView. Allow Bluetooth in Settings, then try again."
        }];
    }
    
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

    // An armed peripheral connects on its own schedule (the patient finished a
    // reading and the cuff started advertising), so nothing set up the tracking
    // fields the way connectGATTPeripheral: does. Fill them in from the
    // peripheral itself before anything downstream reads them.
    NSString *connectedIdentifier = peripheral.identifier.UUIDString;
    if (_bleArmedPeripherals[connectedIdentifier] && ![_connectedGATTIdentifier isEqualToString:connectedIdentifier]) {
        _connectedGATTIdentifier = connectedIdentifier;
        _connectedGATTType = @"BP";
        peripheral.delegate = self;
        [self sendDebugLog:@"🎯 Armed peripheral woke up and connected"];
    }

    _connectedGATTPeripheral = peripheral;
    [self stopGATTScan];

    // Discover services. Device Information and Battery are included on purpose:
    // System ID (2A23) is the only source of the real MAC on iOS, and without
    // 180F a generic device can never report battery the way iHealth ones do.
    // The previous two-service filter is why both were invisible.
    [self sendDebugLog:@"🔍 Discovering GATT services..."];
    NSArray *services = @[
        [CBUUID UUIDWithString:kBLEBloodPressureServiceUUID],
        [CBUUID UUIDWithString:kBLEWeightScaleServiceUUID],
        [CBUUID UUIDWithString:kBLEDeviceInfoServiceUUID],
        [CBUUID UUIDWithString:kBLEBatteryServiceUUID]
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

    // Devices like the UA-651BLE hang up as soon as they have handed over their
    // stored readings, and power off entirely about a minute later. If JS still
    // wants this device, immediately re-issue the pending connect so the next
    // reading is caught too. bleDisarm is what actually ends the session.
    CBPeripheral *armed = _bleArmedPeripherals[peripheral.identifier.UUIDString];
    if (armed) {
        [self sendDebugLog:@"🔁 Still armed — re-issuing pending connect"];
        [_centralManager connectPeripheral:armed options:nil];
    }

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

        // Date Time — written during bonding only. Writing it on every capture
        // would be pointless traffic inside the device's short awake window.
        if ([charUUID containsString:@"2A08"]) {
            NSString *identifier = peripheral.identifier.UUIDString;
            if ([_bleBondingIdentifiers containsObject:identifier] &&
                (characteristic.properties & CBCharacteristicPropertyWrite)) {
                [self sendDebugLog:@"   🕐 Writing current time to Date Time (2A08)"];
                [peripheral writeValue:[self bleDateTimePayload]
                     forCharacteristic:characteristic
                                  type:CBCharacteristicWriteWithResponse];
            }
        }

        // Device Information + Battery. Read on every connection: cheap, and it
        // keeps the battery indicator fresh the same way iHealth devices do.
        if ([charUUID containsString:@"2A23"] ||   // System ID → real MAC
            [charUUID containsString:@"2A25"] ||   // Serial Number
            [charUUID containsString:@"2A24"] ||   // Model Number
            [charUUID containsString:@"2A19"]) {   // Battery Level
            if (characteristic.properties & CBCharacteristicPropertyRead) {
                [peripheral readValueForCharacteristic:characteristic];
            }
        }
    }
}

/**
 * GATT Date Time (2A08) payload: uint16 little-endian year, then month, day,
 * hour, minute, second as single bytes. Seven bytes total.
 */
- (NSData *)bleDateTimePayload {
    NSDateComponents *c = [[NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian]
                           components:(NSCalendarUnitYear | NSCalendarUnitMonth | NSCalendarUnitDay |
                                       NSCalendarUnitHour | NSCalendarUnitMinute | NSCalendarUnitSecond)
                             fromDate:[NSDate date]];

    uint8_t bytes[7];
    bytes[0] = (uint8_t)(c.year & 0xFF);
    bytes[1] = (uint8_t)((c.year >> 8) & 0xFF);
    bytes[2] = (uint8_t)c.month;
    bytes[3] = (uint8_t)c.day;
    bytes[4] = (uint8_t)c.hour;
    bytes[5] = (uint8_t)c.minute;
    bytes[6] = (uint8_t)c.second;

    return [NSData dataWithBytes:bytes length:sizeof(bytes)];
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

    // Device info + battery. Collected into a per-device bucket and flushed as a
    // single event so JS gets one coherent record instead of four partial ones.
    // Hopped to the main queue because _bleDeviceInfo is confined to it.
    NSString *identifier = peripheral.identifier.UUIDString;
    if ([charUUID containsString:@"2A23"]) {
        NSString *mac = [self bleMacFromSystemID:data];
        if (mac) {
            [self sendDebugLog:[NSString stringWithFormat:@"   🆔 System ID → MAC %@", mac]];
            dispatch_async(dispatch_get_main_queue(), ^{
                [self bleSetDeviceInfo:identifier key:@"mac" value:mac];
            });
        }
    } else if ([charUUID containsString:@"2A25"]) {
        NSString *serial = [self bleStringFromData:data];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self bleSetDeviceInfo:identifier key:@"serialNumber" value:serial];
        });
    } else if ([charUUID containsString:@"2A24"]) {
        NSString *model = [self bleStringFromData:data];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self bleSetDeviceInfo:identifier key:@"modelNumber" value:model];
        });
    } else if ([charUUID containsString:@"2A19"]) {
        uint8_t level = ((const uint8_t *)data.bytes)[0];
        dispatch_async(dispatch_get_main_queue(), ^{
            [self bleSetDeviceInfo:identifier key:@"battery" value:@(level)];
            [self sendEventSafe:@"onBatteryLevel" body:@{
                @"mac": identifier,
                @"type": @"GATT_BP",
                @"level": @(level),
                @"source": @"BLE_GATT",
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
            }];
        });
    }
}

#pragma mark - Generic BLE Device Info

/**
 * Always call on the main queue. _bleDeviceInfo is confined to it so the
 * CoreBluetooth queue and the React Native bridge never touch it concurrently,
 * and so the debounce below has a queue that actually runs timers.
 */
- (void)bleSetDeviceInfo:(NSString *)identifier key:(NSString *)key value:(id)value {
    if (!identifier || !value) return;
    NSMutableDictionary *bucket = _bleDeviceInfo[identifier];
    if (!bucket) {
        bucket = [NSMutableDictionary new];
        _bleDeviceInfo[identifier] = bucket;
    }
    bucket[key] = value;

    // The four reads land within milliseconds of each other. Debounce so JS gets
    // one settled record instead of four partial ones it would have to merge.
    // A generation counter supersedes earlier timers; -performSelector:afterDelay:
    // is not an option because the CB delegate queue has no run loop.
    NSUInteger generation = [bucket[@"_generation"] unsignedIntegerValue] + 1;
    bucket[@"_generation"] = @(generation);

    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.4 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        [weakSelf bleFlushDeviceInfo:identifier generation:generation];
    });
}

- (void)bleFlushDeviceInfo:(NSString *)identifier generation:(NSUInteger)generation {
    NSMutableDictionary *bucket = _bleDeviceInfo[identifier];
    if (!bucket) return;
    if ([bucket[@"_generation"] unsignedIntegerValue] != generation) return; // a later read superseded us

    NSMutableDictionary *body = [bucket mutableCopy];
    [body removeObjectForKey:@"_generation"];
    body[@"identifier"] = identifier;
    [self sendEventSafe:@"onBleDeviceInfo" body:body];
}

/**
 * System ID (2A23) is 8 bytes: a 40-bit manufacturer-defined identifier followed
 * by a 24-bit OUI, both little-endian. The 48-bit MAC is the low 3 bytes of the
 * first field plus the OUI — i.e. bytes 7,6,5,2,1,0 read back in that order.
 */
- (NSString *)bleMacFromSystemID:(NSData *)data {
    if (data.length < 8) return nil;
    const uint8_t *b = data.bytes;
    return [[NSString stringWithFormat:@"%02X%02X%02X%02X%02X%02X",
             b[7], b[6], b[5], b[2], b[1], b[0]] uppercaseString];
}

- (NSString *)bleStringFromData:(NSData *)data {
    NSString *s = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
    return [s stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceAndNewlineCharacterSet]] ?: @"";
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
    
    // Bytes 5-6 are Mean Arterial Pressure, which CareView does not record.
    int offset = 7;

    // Timestamp (present only if the device's clock was ever set — see the note
    // on kBLEDateTimeCharUUID). measuredAt stays 0 when absent so JS can tell
    // "the cuff told us when" apart from "we had to guess".
    double measuredAtMs = 0;
    if (flags & 0x02) {
        if (data.length >= offset + 7) {
            NSDateComponents *c = [NSDateComponents new];
            c.year   = bytes[offset] | (bytes[offset + 1] << 8);
            c.month  = bytes[offset + 2];
            c.day    = bytes[offset + 3];
            c.hour   = bytes[offset + 4];
            c.minute = bytes[offset + 5];
            c.second = bytes[offset + 6];

            // Year 0 means "not known" per the GATT spec; treat as absent.
            if (c.year > 0) {
                NSCalendar *cal = [NSCalendar calendarWithIdentifier:NSCalendarIdentifierGregorian];
                NSDate *measuredAt = [cal dateFromComponents:c];
                if (measuredAt) {
                    measuredAtMs = [measuredAt timeIntervalSince1970] * 1000;
                }
            }
        }
        offset += 7;
    }

    int pulseRate = 0;
    if ((flags & 0x04) && data.length >= offset + 2) {
        pulseRate = (int)[self parseSFLOAT:&bytes[offset]];
    }

    // Drop anything that is not a believable blood pressure. Monitors ship with
    // factory-test records in memory and hand them over on the first
    // connection; those carried NaN fields and reached a patient chart as
    // 2047/2047. Silence is the correct outcome — the capture screen simply
    // keeps waiting for a real reading.
    if (![self isPlausibleBPSystolic:systolic diastolic:diastolic pulse:pulseRate]) {
        [self sendDebugLog:[NSString stringWithFormat:
            @"⚠️ Discarded implausible BP: %.1f/%.1f pulse=%d (flags=0x%02X, %lu bytes)",
            systolic, diastolic, pulseRate, flags, (unsigned long)data.length]];
        return;
    }

    [self sendDebugLog:[NSString stringWithFormat:@"🎉 GATT BP: %d/%d mmHg, pulse=%d, deviceTime=%@",
                        (int)systolic, (int)diastolic, pulseRate,
                        measuredAtMs > 0 ? @"yes" : @"no"]];

    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": self->_connectedGATTIdentifier ?: @"",
            @"type": @"GATT_BP",
            @"systolic": @((int)systolic),
            @"diastolic": @((int)diastolic),
            @"pulse": @(pulseRate),
            @"irregular": @NO,
            @"source": @"BLE_GATT",
            // Arrival time — kept for backwards compatibility with existing listeners.
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000),
            // When the cuff says the reading was actually taken. 0 = unknown.
            @"measuredAt": @(measuredAtMs)
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

/**
 * IEEE 11073 16-bit SFLOAT: 12-bit signed mantissa, 4-bit signed exponent.
 *
 * The five reserved mantissa values below are NOT numbers and must never be
 * arithmetically decoded. NaN in particular is 0x07FF — exponent 0, mantissa
 * 0x7FF — which naively evaluates to 2047. A brand-new monitor handed over
 * factory-test records whose fields were NaN, and 2047/2047 mmHg was written
 * into a patient's chart four times. Returning NAN here makes the caller's
 * validity check reject them instead.
 */
- (float)parseSFLOAT:(const uint8_t *)bytes {
    uint16_t raw = bytes[0] | (bytes[1] << 8);

    switch (raw & 0x0FFF) {
        case 0x07FF: return NAN;       // NaN
        case 0x0800: return NAN;       // NRes — not at this resolution
        case 0x07FE: return INFINITY;  // +INFINITY
        case 0x0802: return -INFINITY; // -INFINITY
        case 0x0801: return NAN;       // Reserved
        default: break;
    }

    int16_t mantissa = raw & 0x0FFF;
    int8_t exponent = (raw >> 12) & 0x0F;

    if (mantissa & 0x0800) mantissa |= 0xF000;
    if (exponent & 0x08) exponent |= 0xF0;

    return (float)mantissa * powf(10.0f, (float)exponent);
}

/**
 * Physiological sanity gate — the last line of defence before a number reaches
 * a chart. Deliberately wide: the job is to reject impossible values, not to
 * make clinical judgements about unusual ones.
 *
 * Nothing outside this range is ever emitted. A reading the app cannot vouch
 * for is worth losing; a wrong one in an EMR is not, least of all for a
 * preeclampsia patient where a false 2047/2047 reads as a crisis.
 */
- (BOOL)isPlausibleBPSystolic:(float)systolic diastolic:(float)diastolic pulse:(int)pulse {
    if (!isfinite(systolic) || !isfinite(diastolic)) return NO;
    if (systolic < 30 || systolic > 300) return NO;
    if (diastolic < 10 || diastolic > 250) return NO;
    if (systolic <= diastolic) return NO;
    if (pulse != 0 && (pulse < 20 || pulse > 250)) return NO;
    return YES;
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
    [BG5SController sharedController];
    
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

- (NSString *)bg5sConnectedDeviceSummary {
    NSArray *devices = [[BG5SController sharedController] getAllCurrentInstace];
    NSMutableArray *serials = [NSMutableArray new];
    for (BG5S *d in devices) {
        if (d.serialNumber) [serials addObject:d.serialNumber];
    }
    return serials.count > 0 ? [serials componentsJoinedByString:@", "] : @"none";
}

- (BG5S *)getBG5SWithMac:(NSString *)mac {
    NSArray *devices = [[BG5SController sharedController] getAllCurrentInstace];
    NSString *target = [mac uppercaseString];
    for (BG5S *d in devices) {
        if ([[d.serialNumber uppercaseString] isEqualToString:target]) {
            d.delegate = self;
            return d;
        }
    }
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

    // BG5S glucose meter
    [center addObserver:self selector:@selector(onBG5SDiscover:) name:kNotificationNameBG5SDidDiscover object:nil];
    [center addObserver:self selector:@selector(onBG5SConnected:) name:kNotificationNameBG5SConnectSuccess object:nil];
    [center addObserver:self selector:@selector(onBG5SConnectFailed:) name:kNotificationNameBG5SConnectFail object:nil];
    [center addObserver:self selector:@selector(onBG5SDisconnected:) name:kNotificationNameBG5SDidDisConnect object:nil];

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
    if ([name containsString:@"BG5S"]) return @"BG5S";
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

    // Battery-only connect (add-device flow): read battery + disconnect.
    // MUST short-circuit here — the handlers below auto-start measurement.
    if (_batteryOnlyMAC && [[mac uppercaseString] isEqualToString:[_batteryOnlyMAC uppercaseString]]) {
        _batteryOnlyMAC = nil;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [self queryBatteryOnly:mac type:type];
        });
        return;
    }

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

#pragma mark - BG5S Diagnostic Notification Handlers

- (void)onBG5SDiscover:(NSNotification *)notification {
    NSDictionary *info = notification.userInfo ?: @{};
    NSString *mac = [self getMacFromNotification:notification forType:@"BG5S"];
    [self sendBG5SEvent:@"discover" mac:mac message:@"SDK-only BG5S discovery notification" extra:@{
        @"raw": info.description ?: @""
    }];
    [self sendEventSafe:@"onDeviceFound" body:@{
        @"mac": mac ?: @"",
        @"name": info[@"DeviceName"] ?: @"BG5S",
        @"type": @"BG5S",
        @"rssi": info[@"RSSI"] ?: @(-50),
        @"source": @"iHealthSDK"
    }];
}

- (void)onBG5SConnected:(NSNotification *)notification {
    NSDictionary *info = notification.userInfo ?: @{};
    NSString *mac = [self getMacFromNotification:notification forType:@"BG5S"];
    _bg5sDebugMac = mac;
    _connectedDevices[mac] = @{@"type": @"BG5S", @"mac": mac ?: @"", @"source": @"iHealthSDK"};

    [self sendBG5SEvent:@"connected" mac:mac message:@"SDK-only BG5S connect notification" extra:@{
        @"raw": info.description ?: @"",
        @"connectedInstances": [self bg5sConnectedDeviceSummary]
    }];

    [self sendEventSafe:@"onConnectionStateChanged" body:@{
        @"mac": mac ?: @"",
        @"type": @"BG5S",
        @"connected": @YES,
        @"source": @"iHealthSDK"
    }];

    // Battery-only connect (add-device flow): read battery + disconnect,
    // skipping delegate/measurement setup.
    if (_batteryOnlyMAC && [[mac uppercaseString] isEqualToString:[_batteryOnlyMAC uppercaseString]]) {
        _batteryOnlyMAC = nil;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [self queryBatteryOnly:mac type:@"BG5S"];
        });
        return;
    }

    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        BG5S *device = [self getBG5SWithMac:mac];
        if (device) {
            [self handleBG5SConnected:device mac:mac];
        } else {
            [self sendBG5SEvent:@"control_missing" mac:mac message:@"Connected notification fired, but BG5SController has no matching instance yet" extra:@{
                @"connectedInstances": [self bg5sConnectedDeviceSummary]
            }];
        }
    });
}

- (void)onBG5SConnectFailed:(NSNotification *)notification {
    NSDictionary *info = notification.userInfo ?: @{};
    NSString *mac = [self getMacFromNotification:notification forType:@"BG5S"];
    NSString *message = [NSString stringWithFormat:@"SDK-only BG5S connect failed: %@", info.description ?: @""];
    [self sendBG5SEvent:@"connect_failed" mac:mac message:message extra:@{@"raw": info.description ?: @""}];
    [self sendEventSafe:@"onError" body:@{
        @"mac": mac ?: @"",
        @"type": @"BG5S",
        @"code": @"BG5S_CONNECT_FAILED",
        @"message": message
    }];
}

- (void)onBG5SDisconnected:(NSNotification *)notification {
    NSString *mac = [self getMacFromNotification:notification forType:@"BG5S"];
    [_connectedDevices removeObjectForKey:mac];
    [self sendBG5SEvent:@"disconnected" mac:mac message:@"SDK-only BG5S disconnect notification" extra:nil];
    [self sendEventSafe:@"onConnectionStateChanged" body:@{
        @"mac": mac ?: @"",
        @"type": @"BG5S",
        @"connected": @NO,
        @"source": @"iHealthSDK"
    }];
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
    if ([type isEqualToString:@"BG5S"]) {
        @try {
            BG5S *device = [self getBG5SWithMac:mac];
            if (device) {
                [device disconnectDevice];
                [self sendBG5SEvent:@"disconnect_command" mac:mac message:@"BG5S disconnectDevice called" extra:nil];
            } else {
                [self sendBG5SEvent:@"disconnect_no_device" mac:mac message:@"No BG5S instance available for disconnectDevice" extra:@{
                    @"connectedInstances": [self bg5sConnectedDeviceSummary]
                }];
            }
        } @catch (NSException *e) {
            [self sendBG5SEvent:@"disconnect_exception" mac:mac message:e.reason ?: @"BG5S disconnect exception" extra:nil];
        }
        return;
    }
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

#pragma mark - BG5S Diagnostic Helpers

- (NSString *)bg5sErrorText:(BG5SError)error {
    switch (error) {
        case BG5SError_LowBattery: return @"Low battery or charging-only state";
        case BG5SError_PullOffStripWhenMeasuring: return @"Strip removed during measurement";
        case BG5SError_UnvalidReferenceVoltage: return @"Reference voltage error";
        case BG5SError_StripUsed: return @"Used strip or moisture detected";
        case BG5SError_ErrorOccurInEEPROM: return @"EEPROM/read transmission error";
        case BG5SError_LowTemperature: return @"Low temperature";
        case BG5SError_HighTemperature: return @"High temperature";
        case BG5SError_BluetoothError: return @"Bluetooth error";
        case BG5SError_ResultLow: return @"Result below meter range";
        case BG5SError_ResultHigh: return @"Result above meter range";
        case BG5SError_FactoryError: return @"Factory/device error";
        case BG5SError_InputParametersError: return @"Input parameter error";
        case BG5SError_RecordTotalNumberNotMatchTransferTotalNumber: return @"Record count mismatch";
        case BG5SError_RecordPacketNotMatch: return @"Record packet mismatch";
        case BG5SError_RecordPackerIndexNotMatch: return @"Record packet index mismatch";
        case BG5SError_CommandTimeout: return @"Command timeout";
        case BG5SError_CommandNotSupport: return @"Command not supported";
        case BG5SError_Disconnect: return @"Device disconnected";
        default: return @"Unknown BG5S error";
    }
}

- (NSString *)bg5sStripStateText:(BG5SStripState)state {
    switch (state) {
        case BG5SStripState_Insert: return @"strip_inserted";
        case BG5SStripState_PullOff: return @"strip_removed";
        default: return @"strip_unknown";
    }
}

- (NSString *)bg5sChargeStateText:(BG5SChargeState)state {
    switch (state) {
        case BG5SChargeState_Charging: return @"charging";
        case BG5SChargeState_ExitCharge: return @"not_charging";
        default: return @"charge_unknown";
    }
}

- (NSDictionary *)bg5sStatePayload:(BG5SStateInfo *)stateInfo {
    if (!stateInfo) return @{};
    return @{
        @"batteryValue": @(stateInfo.batteryValue),
        @"deviceDate": stateInfo.deviceDate.description ?: @"",
        @"deviceTimeZone": @(stateInfo.deviceTimeZone),
        @"stripUsedValue": @(stateInfo.stripUsedValue),
        @"offlineDataQuantity": @(stateInfo.offlineDataQuantity),
        @"bloodCodeVersion": @(stateInfo.bloodCodeVersion),
        @"ctlCodeVersion": @(stateInfo.ctlCodeVersion),
        @"unit": @(stateInfo.unit)
    };
}

- (NSArray *)bg5sRecordsPayload:(NSArray *)records {
    NSMutableArray *out = [NSMutableArray new];
    NSDateFormatter *formatter = [[NSDateFormatter alloc] init];
    formatter.dateFormat = @"yyyy-MM-dd HH:mm:ss ZZZZZ";

    for (BG5SRecordModel *record in records) {
        NSString *dateString = record.measureDate ? [formatter stringFromDate:record.measureDate] : @"";
        [out addObject:@{
            @"dataID": record.dataID ?: @"",
            @"measureDate": dateString,
            @"timeZone": @(record.timeZone),
            @"value": @(record.value),
            @"unit": @"mg/dL",
            @"canCorrect": @(record.canCorrect)
        }];
    }
    return out;
}

- (void)handleBG5SConnected:(BG5S *)device mac:(NSString *)mac {
    device.delegate = self;
    _bg5sDebugMac = mac;
    [self sendBG5SEvent:@"control_found" mac:mac message:@"BG5SController returned live device instance and delegate was assigned" extra:@{
        @"connectedInstances": [self bg5sConnectedDeviceSummary]
    }];
}

- (void)bg5sStartBloodMeasure:(BG5S *)device mac:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject {
    [self sendBG5SEvent:@"start_measure" mac:mac message:@"Calling startMeasure with BGMeasureMode_Blood (1)" extra:nil];
    [device startMeasure:BGMeasureMode_Blood withSuccessBlock:^{
        [self sendBG5SEvent:@"start_measure_ok" mac:mac message:@"SDK accepted startMeasure; insert strip/apply blood and wait for callbacks" extra:nil];
        resolve(nil);
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        NSString *text = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, detailInfo ?: @""];
        [self sendBG5SEvent:@"start_measure_error" mac:mac message:text extra:@{@"error": @(error)}];
        reject(@"BG5S_START_ERROR", text, nil);
    }];
}

- (void)bg5sPrepareAndStart:(BG5S *)device mac:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject {
    device.delegate = self;
    _bg5sDebugMac = mac;

    void (^startBlock)(void) = ^{
        [self bg5sStartBloodMeasure:device mac:mac resolver:resolve rejecter:reject];
    };

    void (^setUnitBlock)(void) = ^{
        [self sendBG5SEvent:@"set_unit" mac:mac message:@"Setting unit to mg/dL (BGUnit_mgPmL = 2)" extra:nil];
        [device setUnit:BGUnit_mgPmL successBlock:^{
            [self sendBG5SEvent:@"set_unit_ok" mac:mac message:@"setUnit succeeded" extra:nil];
            startBlock();
        } errorBlock:^(BG5SError error, NSString *detailInfo) {
            NSString *text = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, detailInfo ?: @""];
            [self sendBG5SEvent:@"set_unit_error" mac:mac message:text extra:@{@"error": @(error)}];
            startBlock();
        }];
    };

    void (^setTimeBlock)(void) = ^{
        float timezone = (float)([[NSTimeZone localTimeZone] secondsFromGMTForDate:[NSDate date]] / 3600.0);
        [self sendBG5SEvent:@"set_time" mac:mac message:[NSString stringWithFormat:@"Setting time with timezone %.2f", timezone] extra:nil];
        [device setTimeWithDate:[NSDate date] timezone:timezone successBlock:^{
            [self sendBG5SEvent:@"set_time_ok" mac:mac message:@"setTime succeeded" extra:nil];
            setUnitBlock();
        } errorBlock:^(BG5SError error, NSString *detailInfo) {
            NSString *text = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, detailInfo ?: @""];
            [self sendBG5SEvent:@"set_time_error" mac:mac message:text extra:@{@"error": @(error)}];
            setUnitBlock();
        }];
    };

    [self sendBG5SEvent:@"query_state" mac:mac message:@"Querying BG5S state before measurement" extra:nil];
    [device queryStateInfoWithSuccess:^(BG5SStateInfo *stateInfo) {
        [self sendBG5SEvent:@"query_state_ok" mac:mac message:@"queryStateInfo succeeded" extra:[self bg5sStatePayload:stateInfo]];
        // BG5S battery rides along with the state info — surface it the
        // same way BP/scale batteries are surfaced.
        [self emitBatteryForMac:mac type:@"BG5S" level:@(stateInfo.batteryValue)];
        setTimeBlock();
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        NSString *text = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, detailInfo ?: @""];
        [self sendBG5SEvent:@"query_state_error" mac:mac message:text extra:@{@"error": @(error)}];
        setTimeBlock();
    }];
}

- (void)device:(BG5S *)device occurError:(BG5SError)error errorDescription:(NSString *)errorDescription {
    NSString *mac = device.serialNumber ?: _bg5sDebugMac ?: @"";
    NSString *message = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, errorDescription ?: @""];
    [self sendBG5SEvent:@"device_error" mac:mac message:message extra:@{@"error": @(error)}];
    [self sendEventSafe:@"onError" body:@{
        @"mac": mac,
        @"type": @"BG5S",
        @"code": @"BG5S_DEVICE_ERROR",
        @"error": @(error),
        @"message": message
    }];
}

- (void)device:(BG5S *)device stripStateDidUpdate:(BG5SStripState)state {
    NSString *mac = device.serialNumber ?: _bg5sDebugMac ?: @"";
    NSString *stateText = [self bg5sStripStateText:state];
    [self sendBG5SEvent:@"strip_state" mac:mac message:stateText extra:@{@"state": @(state), @"stateText": stateText}];
}

- (void)deviceDropBlood:(BG5S *)device {
    NSString *mac = device.serialNumber ?: _bg5sDebugMac ?: @"";
    [self sendBG5SEvent:@"blood_detected" mac:mac message:@"Meter says enough blood was applied; waiting for result" extra:nil];
}

- (void)device:(BG5S *)device dataID:(NSString *)dataID measureReult:(NSInteger)result {
    NSString *mac = device.serialNumber ?: _bg5sDebugMac ?: @"";
    [self sendBG5SEvent:@"result" mac:mac message:[NSString stringWithFormat:@"BG5S result %ld mg/dL", (long)result] extra:@{
        @"value": @(result),
        @"unit": @"mg/dL",
        @"dataID": dataID ?: @""
    }];
    [self sendEventSafe:@"onBloodGlucoseReading" body:@{
        @"mac": mac,
        @"type": @"BG5S",
        @"value": @(result),
        @"unit": @"mg/dL",
        @"dataID": dataID ?: @"",
        @"source": @"iHealthSDK",
        @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
    }];
}

- (void)device:(BG5S *)device chargeStateDidUpdate:(BG5SChargeState)state {
    NSString *mac = device.serialNumber ?: _bg5sDebugMac ?: @"";
    NSString *stateText = [self bg5sChargeStateText:state];
    [self sendBG5SEvent:@"charge_state" mac:mac message:stateText extra:@{@"state": @(state), @"stateText": stateText}];
}

#pragma mark - BP Handlers

- (void)handleBP3LConnected:(BP3L *)bp mac:(NSString *)mac {
    [self sendDebugLog:@"🩺 BP3L: Starting measurement..."];

    // Measurement FIRST — the original, proven behavior. Per the SDK docs,
    // commandStartMeasure is what "establishes the measurement connection";
    // sending commandEnergy before or alongside it makes the BP3L drop the
    // link ~1s after connecting (light on, then dead — observed in the
    // field). Battery is queried best-effort AFTER the result is delivered,
    // while the link is still up; if the device disconnects first we simply
    // don't get a level this cycle.
    [bp commandStartMeasureWithZeroingState:^(BOOL c){} pressure:^(NSArray *p){} waveletWithHeartbeat:^(NSArray *w){} waveletWithoutHeartbeat:^(NSArray *w){} result:^(NSDictionary *r) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BP3L RESULT: %@", r]];
        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": mac, @"type": @"BP3L",
            @"systolic": r[@"sys"] ?: @0, @"diastolic": r[@"dia"] ?: @0,
            @"pulse": r[@"heartRate"] ?: @0, @"irregular": r[@"irregular"] ?: @NO,
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
        // Reading is safely delivered — battery is a bonus from here.
        [bp commandEnergy:^(NSNumber *energyValue) {
            [self emitBatteryForMac:mac type:@"BP3L" level:energyValue];
        } errorBlock:^(BPDeviceError e) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚠️ BP3L battery query error: %d", (int)e]];
        }];
    } errorBlock:^(BPDeviceError e) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ BP3L error: %d", (int)e]];
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BP3L", @"error": @(e)}];
    }];
}

- (void)handleBP5Connected:(BP5 *)bp mac:(NSString *)mac {
    [self sendDebugLog:@"🩺 BP5: Starting measurement..."];

    // Measurement first, battery after the result — see handleBP3LConnected.
    [bp commandStartMeasureWithZeroingState:^(BOOL c){} pressure:^(NSArray *p){} waveletWithHeartbeat:^(NSArray *w){} waveletWithoutHeartbeat:^(NSArray *w){} result:^(NSDictionary *r) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BP5 RESULT: %@", r]];
        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": mac, @"type": @"BP5",
            @"systolic": r[@"sys"] ?: @0, @"diastolic": r[@"dia"] ?: @0,
            @"pulse": r[@"heartRate"] ?: @0, @"irregular": r[@"irregular"] ?: @NO,
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
        [bp commandEnergy:^(NSNumber *energyValue) {
            [self emitBatteryForMac:mac type:@"BP5" level:energyValue];
        } errorBlock:^(BPDeviceError e) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚠️ BP5 battery query error: %d", (int)e]];
        }];
    } errorBlock:^(BPDeviceError e) {
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BP5", @"error": @(e)}];
    }];
}

- (void)handleBP5SConnected:(BP5S *)bp mac:(NSString *)mac {
    [self sendDebugLog:@"🩺 BP5S: Starting measurement..."];

    // Measurement first, battery after the result — see handleBP3LConnected.
    [bp commandStartMeasureWithZeroingState:^(BOOL c){} pressure:^(NSArray *p){} waveletWithHeartbeat:^(NSArray *w){} waveletWithoutHeartbeat:^(NSArray *w){} result:^(NSDictionary *r) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BP5S RESULT: %@", r]];
        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": mac, @"type": @"BP5S",
            @"systolic": r[@"sys"] ?: @0, @"diastolic": r[@"dia"] ?: @0,
            @"pulse": r[@"heartRate"] ?: @0, @"irregular": r[@"irregular"] ?: @NO,
            @"source": @"iHealthSDK", @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
        // BP5S battery command carries an extra charging-state block.
        [bp commandEnergy:^(NSNumber *energyValue) {
            [self emitBatteryForMac:mac type:@"BP5S" level:energyValue];
        } energyState:^(NSNumber *energyState){} errorBlock:^(BPDeviceError e) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚠️ BP5S battery query error: %d", (int)e]];
        }];
    } errorBlock:^(BPDeviceError e) {
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BP5S", @"error": @(e)}];
    }];
}

#pragma mark - Scale Handlers

- (void)handleHS2Connected:(HS2 *)scale mac:(NSString *)mac {
    [self sendDebugLog:@"⚖️ HS2: Starting measurement..."];
    // Best-effort battery read before measurement.
    [scale commandGetHS2Battery:^(NSNumber *battary) {
        [self emitBatteryForMac:mac type:@"HS2" level:battary];
    } DiaposeErrorBlock:^(HS2DeviceError e) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚠️ HS2 battery query error: %d", (int)e]];
    }];
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

    // Best-effort battery read before measurement.
    [scale commandGetHS2SBattery:^(NSNumber *battary) {
        [self emitBatteryForMac:mac type:@"HS2S" level:battary];
    } DiaposeErrorBlock:^(HS2SDeviceError e) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚠️ HS2S battery query error: %d", (int)e]];
    }];

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

RCT_EXPORT_METHOD(debugBG5SStartScan:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    @try {
        [self sendBG5SEvent:@"scan_start" mac:@"" message:@"Starting SDK-only BG5S scan" extra:nil];
        if (!_controllersInitialized) [self initializeControllers];
        [[ScanDeviceController commandGetInstance] commandScanDeviceType:HealthDeviceType_BG5S];
        [self sendEventSafe:@"onScanStateChanged" body:@{@"scanning": @YES, @"type": @"BG5S"}];
        resolve(nil);
    } @catch (NSException *e) {
        NSString *message = [NSString stringWithFormat:@"BG5S scan exception: %@", e.reason ?: @""];
        [self sendBG5SEvent:@"scan_exception" mac:@"" message:message extra:nil];
        reject(@"BG5S_SCAN_EXCEPTION", message, nil);
    }
}

RCT_EXPORT_METHOD(debugBG5SStopScan:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    @try {
        [[ScanDeviceController commandGetInstance] commandStopScanDeviceType:HealthDeviceType_BG5S];
        [self sendBG5SEvent:@"scan_stop" mac:@"" message:@"Stopped SDK-only BG5S scan" extra:nil];
        [self sendEventSafe:@"onScanStateChanged" body:@{@"scanning": @NO, @"type": @"BG5S"}];
        resolve(nil);
    } @catch (NSException *e) {
        NSString *message = [NSString stringWithFormat:@"BG5S stop scan exception: %@", e.reason ?: @""];
        reject(@"BG5S_STOP_SCAN_EXCEPTION", message, nil);
    }
}

RCT_EXPORT_METHOD(debugBG5SQueryState:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    BG5S *device = [self getBG5SWithMac:mac];
    if (!device) {
        NSString *message = [NSString stringWithFormat:@"No BG5S instance for %@. Connected instances: %@", mac, [self bg5sConnectedDeviceSummary]];
        [self sendBG5SEvent:@"query_state_no_device" mac:mac message:message extra:nil];
        reject(@"BG5S_NO_DEVICE", message, nil);
        return;
    }

    [self sendBG5SEvent:@"query_state" mac:mac message:@"Querying BG5S state" extra:nil];
    [device queryStateInfoWithSuccess:^(BG5SStateInfo *stateInfo) {
        NSDictionary *payload = [self bg5sStatePayload:stateInfo];
        [self sendBG5SEvent:@"query_state_ok" mac:mac message:@"queryStateInfo succeeded" extra:payload];
        [self emitBatteryForMac:mac type:@"BG5S" level:@(stateInfo.batteryValue)];
        resolve(payload);
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        NSString *message = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, detailInfo ?: @""];
        [self sendBG5SEvent:@"query_state_error" mac:mac message:message extra:@{@"error": @(error)}];
        reject(@"BG5S_QUERY_STATE_ERROR", message, nil);
    }];
}

RCT_EXPORT_METHOD(debugBG5SPrepareAndStart:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    BG5S *device = [self getBG5SWithMac:mac];
    if (!device) {
        NSString *message = [NSString stringWithFormat:@"No BG5S instance for %@. Connected instances: %@", mac, [self bg5sConnectedDeviceSummary]];
        [self sendBG5SEvent:@"prepare_no_device" mac:mac message:message extra:nil];
        reject(@"BG5S_NO_DEVICE", message, nil);
        return;
    }
    [self bg5sPrepareAndStart:device mac:mac resolver:resolve rejecter:reject];
}

RCT_EXPORT_METHOD(debugBG5SSetCodeAndStart:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    BG5S *device = [self getBG5SWithMac:mac];
    if (!device) {
        NSString *message = [NSString stringWithFormat:@"No BG5S instance for %@. Connected instances: %@", mac, [self bg5sConnectedDeviceSummary]];
        [self sendBG5SEvent:@"set_code_no_device" mac:mac message:message extra:nil];
        reject(@"BG5S_NO_DEVICE", message, nil);
        return;
    }

    device.delegate = self;
    [self sendBG5SEvent:@"set_code" mac:mac message:@"Calling setCodeWithMeasureMode with BGMeasureMode_Blood (1), then startMeasure" extra:nil];
    [device setCodeWithMeasureMode:BGMeasureMode_Blood resultBlock:^(BOOL success) {
        [self sendBG5SEvent:@"set_code_result" mac:mac message:(success ? @"setCodeWithMeasureMode returned success" : @"setCodeWithMeasureMode returned false") extra:@{@"success": @(success)}];
        [self bg5sStartBloodMeasure:device mac:mac resolver:resolve rejecter:reject];
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        NSString *message = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, detailInfo ?: @""];
        [self sendBG5SEvent:@"set_code_error" mac:mac message:message extra:@{@"error": @(error)}];
        reject(@"BG5S_SET_CODE_ERROR", message, nil);
    }];
}

RCT_EXPORT_METHOD(debugBG5SReadDeviceInfo:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    BG5S *device = [self getBG5SWithMac:mac];
    if (!device) {
        NSString *message = [NSString stringWithFormat:@"No BG5S instance for %@. Connected instances: %@", mac, [self bg5sConnectedDeviceSummary]];
        [self sendBG5SEvent:@"read_info_no_device" mac:mac message:message extra:nil];
        reject(@"BG5S_NO_DEVICE", message, nil);
        return;
    }

    [self sendBG5SEvent:@"read_device_info" mac:mac message:@"Calling readDeviceInfoWithSuccessBlock" extra:nil];
    [device readDeviceInfoWithSuccessBlock:^(NSDictionary *deviceInfoDic) {
        NSDictionary *safeInfo = deviceInfoDic ?: @{};
        NSDictionary *payload = @{@"raw": safeInfo.description ?: @""};
        [self sendBG5SEvent:@"read_device_info_ok" mac:mac message:@"readDeviceInfo succeeded" extra:payload];
        resolve(payload);
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        NSString *message = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, detailInfo ?: @""];
        [self sendBG5SEvent:@"read_device_info_error" mac:mac message:message extra:@{@"error": @(error)}];
        reject(@"BG5S_READ_INFO_ERROR", message, nil);
    }];
}

RCT_EXPORT_METHOD(debugBG5SGetOfflineData:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    BG5S *device = [self getBG5SWithMac:mac];
    if (!device) {
        NSString *message = [NSString stringWithFormat:@"No BG5S instance for %@. Connected instances: %@", mac, [self bg5sConnectedDeviceSummary]];
        [self sendBG5SEvent:@"offline_data_no_device" mac:mac message:message extra:nil];
        reject(@"BG5S_NO_DEVICE", message, nil);
        return;
    }

    [self sendBG5SEvent:@"offline_data" mac:mac message:@"Calling queryRecordWithSuccessBlock" extra:nil];
    [device queryRecordWithSuccessBlock:^(NSArray *array) {
        NSArray *records = [self bg5sRecordsPayload:array ?: @[]];
        NSDictionary *payload = @{@"count": @(records.count), @"records": records};
        [self sendBG5SEvent:@"offline_data_ok" mac:mac message:[NSString stringWithFormat:@"queryRecord returned %lu record(s)", (unsigned long)records.count] extra:payload];
        resolve(payload);
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        NSString *message = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, detailInfo ?: @""];
        [self sendBG5SEvent:@"offline_data_error" mac:mac message:message extra:@{@"error": @(error)}];
        reject(@"BG5S_OFFLINE_DATA_ERROR", message, nil);
    }];
}

RCT_EXPORT_METHOD(debugBG5SDeleteOfflineData:(NSString *)mac resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    BG5S *device = [self getBG5SWithMac:mac];
    if (!device) {
        NSString *message = [NSString stringWithFormat:@"No BG5S instance for %@. Connected instances: %@", mac, [self bg5sConnectedDeviceSummary]];
        [self sendBG5SEvent:@"delete_offline_no_device" mac:mac message:message extra:nil];
        reject(@"BG5S_NO_DEVICE", message, nil);
        return;
    }

    [self sendBG5SEvent:@"delete_offline" mac:mac message:@"Calling deleteRecordWithSuccessBlock" extra:nil];
    [device deleteRecordWithSuccessBlock:^{
        NSDictionary *payload = @{@"deleted": @YES};
        [self sendBG5SEvent:@"delete_offline_ok" mac:mac message:@"deleteRecord succeeded" extra:payload];
        resolve(payload);
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        NSString *message = [NSString stringWithFormat:@"%@ (%ld) %@", [self bg5sErrorText:error], (long)error, detailInfo ?: @""];
        [self sendBG5SEvent:@"delete_offline_error" mac:mac message:message extra:@{@"error": @(error)}];
        reject(@"BG5S_DELETE_OFFLINE_ERROR", message, nil);
    }];
}

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
            self->_isAuthenticated = NO;
            [self sendDebugLog:[NSString stringWithFormat:@"🔑 Auth failed: %ld", (long)e]];
            resolve(@NO);
        }];
}

RCT_EXPORT_METHOD(isAuthenticated:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(@(_isAuthenticated));
}

RCT_EXPORT_METHOD(getBluetoothStatus:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    resolve([self bluetoothStatusPayload]);
}

RCT_EXPORT_METHOD(startScan:(NSArray *)deviceTypes resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"📶 Scan: Starting for %@", deviceTypes]];
    NSDictionary *btStatus = [self bluetoothStatusPayload];
    if (![btStatus[@"ready"] boolValue]) {
        NSString *state = btStatus[@"state"] ?: @"unknown";
        NSString *message = btStatus[@"message"] ?: @"Bluetooth is not ready.";
        NSString *code = [state isEqualToString:@"unauthorized"] ? @"BLUETOOTH_UNAUTHORIZED" : @"BLUETOOTH_OFF";
        [self sendEventSafe:@"onError" body:@{@"code": code, @"message": message}];
        reject(code, message, nil);
        return;
    }

    if (!_controllersInitialized) [self initializeControllers];

    ScanDeviceController *scanner = [ScanDeviceController commandGetInstance];
    for (NSString *type in deviceTypes) {
        if ([type hasPrefix:@"BP"] || [type hasPrefix:@"HS"] || [type isEqualToString:@"BG5S"]) {
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
    [scanner commandStopScanDeviceType:HealthDeviceType_BG5S];
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

#pragma mark - Generic BLE (A&D and other standard BP/scale profiles)
//
// These methods exist so the generic-BLE capture flow never has to reuse the
// iHealth entry points. Nothing below touches ScanDeviceController,
// ConnectDeviceController, or any iHealth SDK state.

/**
 * bleBondDevice — Add Device flow, run while the cuff shows "Pr".
 *
 * Connects, which triggers iOS's pairing prompt when the encrypted measurement
 * characteristic is accessed. Once bonded we write the clock and read System ID,
 * serial, model and battery, then drop the link. Results arrive as
 * onBleDeviceInfo. Resolving true means "connect was requested", not "bonded" —
 * bonding is asynchronous and the user may still decline the prompt.
 */
RCT_EXPORT_METHOD(bleBondDevice:(NSString *)identifier
                       resolver:(RCTPromiseResolveBlock)resolve
                       rejecter:(RCTPromiseRejectBlock)reject) {
    CBPeripheral *peripheral = [self bleResolvePeripheral:identifier];
    if (!peripheral) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ BLE bond: no peripheral for %@", identifier]];
        reject(@"BLE_NO_PERIPHERAL",
               @"Device not found. Put the monitor in pairing mode and scan again.", nil);
        return;
    }

    [self sendDebugLog:[NSString stringWithFormat:@"🤝 BLE bond: connecting to %@", identifier]];
    [_bleBondingIdentifiers addObject:identifier];
    [_bleDeviceInfo removeObjectForKey:identifier];

    _connectedGATTIdentifier = identifier;
    _connectedGATTType = @"BP";
    peripheral.delegate = self;
    _gattPeripherals[identifier] = peripheral;
    [_centralManager connectPeripheral:peripheral options:nil];

    // Provisioning only needs a few seconds of the device's short awake window.
    // Tear down afterwards so the cuff isn't held open needlessly.
    __weak typeof(self) weakSelf = self;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(12 * NSEC_PER_SEC)),
                   dispatch_get_main_queue(), ^{
        [weakSelf bleFinishBonding:identifier];
    });

    resolve(@YES);
}

- (void)bleFinishBonding:(NSString *)identifier {
    if (![_bleBondingIdentifiers containsObject:identifier]) return;
    [_bleBondingIdentifiers removeObject:identifier];

    // Never tear down a link the capture flow is relying on.
    if (_bleArmedPeripherals[identifier]) return;

    CBPeripheral *peripheral = _gattPeripherals[identifier];
    if (peripheral && peripheral.state == CBPeripheralStateConnected) {
        [self sendDebugLog:@"🤝 BLE bond: provisioning done, disconnecting"];
        [_centralManager cancelPeripheralConnection:peripheral];
    }
}

/**
 * bleArm — capture flow. Leaves a pending connect request open.
 *
 * CoreBluetooth holds connectPeripheral: indefinitely and does not contact the
 * device until it advertises, so the cuff stays asleep and its own power-off
 * timer never starts early. The patient can take a reading whenever; the phone
 * connects the instant the cuff broadcasts. A filtered scan runs alongside as
 * redundancy in case the pending connect misses the advertisement.
 */
RCT_EXPORT_METHOD(bleArm:(NSString *)identifier
                resolver:(RCTPromiseResolveBlock)resolve
                rejecter:(RCTPromiseRejectBlock)reject) {
    CBPeripheral *peripheral = [self bleResolvePeripheral:identifier];
    if (!peripheral) {
        // Not cached yet (fresh app launch, and iOS could not restore it).
        // Fall back to scanning; connectDevice picks it up on discovery.
        [self sendDebugLog:@"⚠️ BLE arm: peripheral unknown, falling back to scan"];
        _targetMAC = identifier;
        _scanningForGATT = YES;
        [self startGATTScan];
        resolve(@NO);
        return;
    }

    [self sendDebugLog:[NSString stringWithFormat:@"🎯 BLE arm: pending connect for %@", identifier]];
    peripheral.delegate = self;
    _bleArmedPeripherals[identifier] = peripheral;
    _gattPeripherals[identifier] = peripheral;
    _targetMAC = identifier;
    [_centralManager connectPeripheral:peripheral options:nil];

    // Redundant discovery path — harmless if the pending connect wins.
    [self startGATTScan];

    resolve(@YES);
}

/**
 * bleDisarm — cancels the pending connect and any live link. Called when the
 * capture screen closes or a reading has been banked.
 */
RCT_EXPORT_METHOD(bleDisarm:(NSString *)identifier
                   resolver:(RCTPromiseResolveBlock)resolve
                   rejecter:(RCTPromiseRejectBlock)reject) {
    CBPeripheral *peripheral = _bleArmedPeripherals[identifier];
    [_bleArmedPeripherals removeObjectForKey:identifier];

    if (peripheral) {
        [self sendDebugLog:[NSString stringWithFormat:@"🛑 BLE disarm: %@", identifier]];
        [_centralManager cancelPeripheralConnection:peripheral];
    }
    if ([_targetMAC isEqualToString:identifier]) {
        _targetMAC = nil;
    }
    [self stopGATTScan];
    resolve(nil);
}

/**
 * Find a peripheral by CoreBluetooth identifier: from this session's scan cache
 * first, then from iOS's own store. The latter is what makes capture work after
 * an app restart, when nothing has been scanned yet.
 */
- (CBPeripheral *)bleResolvePeripheral:(NSString *)identifier {
    if (identifier.length == 0) return nil;

    CBPeripheral *cached = _gattPeripherals[identifier];
    if (cached) return cached;

    NSUUID *uuid = [[NSUUID alloc] initWithUUIDString:identifier];
    if (!uuid) return nil;

    NSArray<CBPeripheral *> *known = [_centralManager retrievePeripheralsWithIdentifiers:@[uuid]];
    CBPeripheral *peripheral = known.firstObject;
    if (peripheral) {
        _gattPeripherals[identifier] = peripheral;
    }
    return peripheral;
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
    NSDictionary *info = _connectedDevices[mac];
    NSString *type = info[@"type"];
    if ([type isEqualToString:@"BG5S"]) {
        BG5S *device = [self getBG5SWithMac:mac];
        if (!device) {
            NSString *message = [NSString stringWithFormat:@"No BG5S instance for %@. Connected instances: %@", mac, [self bg5sConnectedDeviceSummary]];
            reject(@"BG5S_NO_DEVICE", message, nil);
            return;
        }
        [self bg5sStartBloodMeasure:device mac:mac resolver:resolve rejecter:reject];
        return;
    }
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

// Connect solely to read the battery level (add-device flow). The normal
// connect path auto-starts a measurement — this one queries battery and
// disconnects instead (see the _batteryOnlyMAC branch in onConnected /
// the BG5S connect handler). HS4S has no battery API: resolves NO
// without connecting. Battery arrives via the onBatteryLevel event.
RCT_EXPORT_METHOD(connectForBattery:(NSString *)mac deviceType:(NSString *)deviceType resolver:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    NSArray *supported = @[@"BP3L", @"BP5", @"BP5S", @"HS2", @"HS2S", @"BG5S"];
    if (!mac || ![supported containsObject:deviceType]) {
        resolve(@NO);
        return;
    }

    [self sendDebugLog:[NSString stringWithFormat:@"🔋 Connect for battery: %@ (%@)", mac, deviceType]];
    _batteryOnlyMAC = mac;
    _targetMAC = mac;
    _targetType = deviceType;

    int result = [[ConnectDeviceController commandGetInstance] commandContectDeviceWithDeviceType:[self deviceTypeFromString:deviceType] andSerialNub:mac];
    resolve(result == 1 ? @YES : @NO);

    // Failsafe: if the device dozed off or the battery round-trip stalls,
    // clear the flag and drop the half-open connection so a later real
    // capture starts clean. ONLY act when this battery-only session is
    // still pending — otherwise a completed battery read followed by a
    // real capture on the same device within 15s would get its live
    // measurement disconnected by this stale timer.
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(15.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        BOOL stillPending = self->_batteryOnlyMAC &&
            [[self->_batteryOnlyMAC uppercaseString] isEqualToString:[mac uppercaseString]];
        if (!stillPending) return;

        self->_batteryOnlyMAC = nil;
        if (self->_connectedDevices[mac]) {
            [self sendDebugLog:[NSString stringWithFormat:@"🔋 Battery-only timeout — disconnecting %@", mac]];
            [self disconnectSDKDevice:mac type:deviceType];
            [self->_connectedDevices removeObjectForKey:mac];
        }
    });
}

RCT_EXPORT_METHOD(keepAwake) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = YES;
  });
}

RCT_EXPORT_METHOD(allowSleep) {
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIApplication sharedApplication].idleTimerDisabled = NO;
  });
}

- (HealthDeviceType)deviceTypeFromString:(NSString *)type {
    if ([type isEqualToString:@"BP3L"]) return HealthDeviceType_BP3L;
    if ([type isEqualToString:@"BP5"]) return HealthDeviceType_BP5;
    if ([type isEqualToString:@"BP5S"]) return HealthDeviceType_BP5S;
    if ([type isEqualToString:@"BG5S"]) return HealthDeviceType_BG5S;
    if ([type isEqualToString:@"HS2"]) return HealthDeviceType_HS2;
    if ([type isEqualToString:@"HS2S"]) return HealthDeviceType_HS2S;
    if ([type isEqualToString:@"HS4S"]) return HealthDeviceType_HS4;
    return HealthDeviceType_BP3L;
}

@end

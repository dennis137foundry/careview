#import "IHealthDevices.h"
#import <CoreBluetooth/CoreBluetooth.h>
#import "Headers/IHSDKCloudUser.h"
#import "Headers/ScanDeviceController.h"
#import "Headers/ConnectDeviceController.h"
#import "Headers/HealthHeader.h"
#import "Headers/HealthUser.h"

// Blood Pressure
#import "Headers/BP3L.h"
#import "Headers/BP3LController.h"
#import "Headers/BP5.h"
#import "Headers/BP5Controller.h"
#import "Headers/BP5S.h"
#import "Headers/BP5SController.h"
#import "Headers/BPMacroFile.h"

// Blood Glucose
#import "Headers/BG5.h"
#import "Headers/BG5S.h"
#import "Headers/BG5Controller.h"
#import "Headers/BG5SController.h"
#import "Headers/BGMacroFile.h"

// Scales
#import "Headers/HS2.h"
#import "Headers/HS2Controller.h"
#import "Headers/HS2S.h"
#import "Headers/HS2SController.h"
#import "Headers/HS4.h"
#import "Headers/HS4Controller.h"
#import "Headers/HSMacroFile.h"

// BG5S uses delegate pattern
@interface IHealthDevices () <BG5SDelegate, CBCentralManagerDelegate, CBPeripheralDelegate>
@end

// BG5S BLE characteristic UUIDs (for fallback CoreBluetooth path if SDK fails)
static NSString * const kBG5SServiceUUID = @"636F6D2E-6A69-7561-6E2E-646576000000";
static NSString * const kBG5SNotifyCharUUID = @"7365642E-6A69-7561-6E2E-646576000000";
static NSString * const kBG5SWriteCharUUID = @"7265632E-6A69-7561-6E2E-646576000000";

@implementation IHealthDevices {
    BOOL _isAuthenticated;
    BOOL _hasListeners;
    BOOL _controllersInitialized;
    NSMutableDictionary *_connectedDevices;
    NSString *_targetMAC;
    NSString *_targetType;
    
    // CoreBluetooth for fallback BG5S scanning (only used if SDK scan fails)
    CBCentralManager *_centralManager;
    BOOL _isScanning;
    BOOL _scanningForBG5S;
    NSMutableDictionary *_discoveredBG5SDevices;
    NSMutableDictionary *_bg5sPeripherals;
    CBPeripheral *_connectedBG5SPeripheral;
    NSString *_connectedBG5SSerial;
    
    // BG5S BLE characteristics for fallback direct communication
    CBCharacteristic *_bg5sNotifyChar;
    CBCharacteristic *_bg5sWriteChar;
    BOOL _bg5sMeasurementActive;
    NSMutableArray *_bg5sRxLog;
    BOOL _bg5sNotificationsEnabled;
}

RCT_EXPORT_MODULE();

- (instancetype)init {
    self = [super init];
    if (self) {
        _isAuthenticated = NO;
        _controllersInitialized = NO;
        _connectedDevices = [NSMutableDictionary new];
        _discoveredBG5SDevices = [NSMutableDictionary new];
        _bg5sPeripherals = [NSMutableDictionary new];
        _isScanning = NO;
        _scanningForBG5S = NO;
        _connectedBG5SPeripheral = nil;
        _connectedBG5SSerial = nil;
        _bg5sNotifyChar = nil;
        _bg5sWriteChar = nil;
        _bg5sMeasurementActive = NO;
        _bg5sRxLog = [NSMutableArray new];
        _bg5sNotificationsEnabled = NO;
        [self registerNotifications];
        
        // Initialize CoreBluetooth manager (kept for fallback if SDK scan fails)
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
             @"onBloodPressureReading", @"onBloodGlucoseReading", @"onBloodGlucoseStatus",
             @"onWeightReading", @"onError", @"onDebugLog", @"onBG5SProtocolData"];
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

- (NSString *)hexStringFromData:(NSData *)data {
    if (!data || data.length == 0) return @"(empty)";
    const uint8_t *bytes = data.bytes;
    NSMutableString *hex = [NSMutableString stringWithCapacity:data.length * 3];
    for (NSUInteger i = 0; i < data.length; i++) {
        [hex appendFormat:@"%02X ", bytes[i]];
    }
    return [hex stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
}

- (NSString *)asciiStringFromData:(NSData *)data {
    if (!data || data.length == 0) return @"";
    const uint8_t *bytes = data.bytes;
    NSMutableString *ascii = [NSMutableString new];
    for (NSUInteger i = 0; i < data.length; i++) {
        if (bytes[i] >= 32 && bytes[i] < 127) {
            [ascii appendFormat:@"%c", bytes[i]];
        } else {
            [ascii appendString:@"."];
        }
    }
    return ascii;
}

- (NSData *)dataFromHexString:(NSString *)hexString {
    NSString *hex = [[hexString stringByReplacingOccurrencesOfString:@" " withString:@""] uppercaseString];
    NSMutableData *data = [NSMutableData new];
    for (NSUInteger i = 0; i + 1 < hex.length; i += 2) {
        NSString *byteStr = [hex substringWithRange:NSMakeRange(i, 2)];
        unsigned int byte;
        [[NSScanner scannerWithString:byteStr] scanHexInt:&byte];
        uint8_t b = (uint8_t)byte;
        [data appendBytes:&b length:1];
    }
    return data;
}

#pragma mark - CoreBluetooth Delegate (Fallback BG5S Discovery)

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
    
    if (central.state == CBManagerStatePoweredOn && _scanningForBG5S) {
        [self sendDebugLog:@"📱 BT ready, starting deferred BG5S fallback scan..."];
        [self startCoreBluetoothScanForBG5S];
    }
}

- (void)centralManager:(CBCentralManager *)central
 didDiscoverPeripheral:(CBPeripheral *)peripheral
     advertisementData:(NSDictionary<NSString *,id> *)advertisementData
                  RSSI:(NSNumber *)RSSI {
    
    NSString *localName = advertisementData[CBAdvertisementDataLocalNameKey] ?: @"";
    NSString *peripheralName = peripheral.name ?: @"";
    NSString *displayName = localName.length > 0 ? localName : peripheralName;
    
    // Check if this is a BG5S device
    BOOL isBG5S = [localName.uppercaseString containsString:@"BG5S"] || 
                  [peripheralName.uppercaseString containsString:@"BG5S"];
    
    if (isBG5S) {
        NSString *identifier = peripheral.identifier.UUIDString;
        NSString *serialNumber = @"";
        
        // Extract serial from device name: "BG5S 11070" -> "11070"
        NSString *nameToCheck = localName.length > 0 ? localName : peripheralName;
        NSArray *parts = [nameToCheck componentsSeparatedByString:@" "];
        if (parts.count >= 2) {
            serialNumber = parts[1];
            [self sendDebugLog:[NSString stringWithFormat:@"📡 BG5S serial from name: %@", serialNumber]];
        } else {
            // Fallback to UUID prefix
            serialNumber = [[identifier substringToIndex:8] uppercaseString];
        }
        
        // Avoid duplicate notifications
        if (_discoveredBG5SDevices[identifier]) {
            return;
        }
        
        _discoveredBG5SDevices[identifier] = @{
            @"peripheral": peripheral,
            @"serial": serialNumber,
            @"name": displayName,
            @"uuid": identifier
        };
        // Store by multiple keys for lookup flexibility
        _bg5sPeripherals[serialNumber] = peripheral;
        _bg5sPeripherals[identifier] = peripheral;
        _bg5sPeripherals[displayName] = peripheral;
        
        [self sendDebugLog:[NSString stringWithFormat:@"📡 BG5S DISCOVERED: %@ (serial: %@)", displayName, serialNumber]];
        
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventSafe:@"onDeviceFound" body:@{
                @"mac": serialNumber,
                @"name": displayName,
                @"type": @"BG5S",
                @"rssi": RSSI,
                @"uuid": identifier,
                @"source": @"CoreBluetooth"
            }];
        });
        
        // Auto-connect to ANY BG5S if we're looking for one
        if (self->_targetMAC && [self->_targetType isEqualToString:@"BG5S"]) {
            [self sendDebugLog:@"🎯 BG5S FOUND - auto-connecting via CoreBluetooth..."];
            [self connectBG5SPeripheral:peripheral serial:serialNumber];
        }
    }
}

- (void)startCoreBluetoothScanForBG5S {
    if (_centralManager.state != CBManagerStatePoweredOn) {
        [self sendDebugLog:@"📱 CoreBluetooth not ready, will scan when powered on"];
        _scanningForBG5S = YES;
        return;
    }
    
    [self sendDebugLog:@"📡 Starting CoreBluetooth FALLBACK scan for BG5S..."];
    [_discoveredBG5SDevices removeAllObjects];
    
    [_centralManager scanForPeripheralsWithServices:nil options:@{
        CBCentralManagerScanOptionAllowDuplicatesKey: @NO
    }];
    
    _isScanning = YES;
    
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(20 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (self->_isScanning && self->_scanningForBG5S) {
            [self sendDebugLog:@"📡 CoreBluetooth BG5S scan timeout"];
            [self stopCoreBluetoothScan];
        }
    });
}

- (void)stopCoreBluetoothScan {
    if (_centralManager.isScanning) {
        [_centralManager stopScan];
        [self sendDebugLog:@"📡 CoreBluetooth scan stopped"];
    }
    _isScanning = NO;
    _scanningForBG5S = NO;
}

#pragma mark - CoreBluetooth Connection for BG5S (Fallback)

- (void)connectBG5SPeripheral:(CBPeripheral *)peripheral serial:(NSString *)serial {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 BG5S: Connecting via CoreBluetooth to %@...", serial]];
    
    _connectedBG5SSerial = serial;
    peripheral.delegate = self;
    [_centralManager connectPeripheral:peripheral options:nil];
}

- (CBPeripheral *)findBG5SPeripheralBySerial:(NSString *)serial {
    CBPeripheral *peripheral = _bg5sPeripherals[serial];
    if (peripheral) return peripheral;
    
    for (NSString *identifier in _discoveredBG5SDevices) {
        NSDictionary *info = _discoveredBG5SDevices[identifier];
        NSString *deviceSerial = info[@"serial"];
        if ([deviceSerial isEqualToString:serial] || 
            [serial containsString:deviceSerial] ||
            [deviceSerial containsString:serial]) {
            return info[@"peripheral"];
        }
    }
    return nil;
}

- (void)centralManager:(CBCentralManager *)central didConnectPeripheral:(CBPeripheral *)peripheral {
    [self sendDebugLog:[NSString stringWithFormat:@"🔗 CoreBluetooth CONNECTED: %@", peripheral.name]];
    
    _connectedBG5SPeripheral = peripheral;
    [self stopCoreBluetoothScan];
    
    [self sendDebugLog:@"🔍 Discovering BG5S services..."];
    [peripheral discoverServices:nil];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *serial = self->_connectedBG5SSerial ?: @"";
        self->_connectedDevices[serial] = @{@"type": @"BG5S", @"mac": serial};
        
        [self sendEventSafe:@"onConnectionStateChanged" body:@{
            @"mac": serial,
            @"type": @"BG5S",
            @"connected": @YES,
            @"source": @"CoreBluetooth"
        }];
        
        // Try SDK connection after CoreBluetooth connects
        ConnectDeviceController *connector = [ConnectDeviceController commandGetInstance];
        int result = [connector commandContectDeviceWithDeviceType:HealthDeviceType_BG5S andSerialNub:serial];
        [self sendDebugLog:[NSString stringWithFormat:@"🔌 SDK connect attempt after CB connect: %d", result]];
    });
}

- (void)centralManager:(CBCentralManager *)central didFailToConnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    [self sendDebugLog:[NSString stringWithFormat:@"❌ CoreBluetooth connection FAILED: %@", error.localizedDescription]];
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventSafe:@"onError" body:@{
            @"mac": self->_connectedBG5SSerial ?: @"",
            @"type": @"BG5S",
            @"error": @(-1),
            @"message": error.localizedDescription ?: @"Connection failed"
        }];
    });
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 CoreBluetooth DISCONNECTED: %@ (error: %@)", 
                       peripheral.name, error.localizedDescription ?: @"none"]];
    
    NSString *serial = _connectedBG5SSerial ?: @"";
    [_connectedDevices removeObjectForKey:serial];
    
    _connectedBG5SPeripheral = nil;
    _connectedBG5SSerial = nil;
    _bg5sNotifyChar = nil;
    _bg5sWriteChar = nil;
    _bg5sMeasurementActive = NO;
    _bg5sNotificationsEnabled = NO;
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventSafe:@"onConnectionStateChanged" body:@{
            @"mac": serial,
            @"type": @"BG5S",
            @"connected": @NO
        }];
    });
}

#pragma mark - CBPeripheralDelegate (BG5S Service Discovery)

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverServices:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ BG5S service discovery error: %@", error.localizedDescription]];
        return;
    }
    
    [self sendDebugLog:[NSString stringWithFormat:@"🔍 BG5S discovered %lu services", (unsigned long)peripheral.services.count]];
    
    for (CBService *service in peripheral.services) {
        [self sendDebugLog:[NSString stringWithFormat:@"   Service: %@", service.UUID]];
        [peripheral discoverCharacteristics:nil forService:service];
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didDiscoverCharacteristicsForService:(CBService *)service error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ BG5S characteristic discovery error: %@", error.localizedDescription]];
        return;
    }
    
    [self sendDebugLog:[NSString stringWithFormat:@"🔍 BG5S service %@ has %lu characteristics", 
                       service.UUID, (unsigned long)service.characteristics.count]];
    
    for (CBCharacteristic *characteristic in service.characteristics) {
        NSString *uuidStr = [characteristic.UUID.UUIDString uppercaseString];
        [self sendDebugLog:[NSString stringWithFormat:@"   Characteristic: %@ (props: %lu)", 
                           characteristic.UUID, (unsigned long)characteristic.properties]];
        
        NSString *notifyUUID = [kBG5SNotifyCharUUID uppercaseString];
        NSString *writeUUID = [kBG5SWriteCharUUID uppercaseString];
        
        if ([uuidStr isEqualToString:notifyUUID]) {
            _bg5sNotifyChar = characteristic;
            [self sendDebugLog:@"   ✅ Found BG5S NOTIFY characteristic"];
            [peripheral setNotifyValue:YES forCharacteristic:characteristic];
        }
        else if ([uuidStr isEqualToString:writeUUID]) {
            _bg5sWriteChar = characteristic;
            [self sendDebugLog:@"   ✅ Found BG5S WRITE characteristic"];
        }
        else if ((characteristic.properties & CBCharacteristicPropertyWrite) || 
                 (characteristic.properties & CBCharacteristicPropertyWriteWithoutResponse)) {
            if (!_bg5sWriteChar) {
                _bg5sWriteChar = characteristic;
                [self sendDebugLog:@"   ✅ Found WRITABLE characteristic (fallback)"];
            }
        }
        
        if (characteristic.properties & (CBCharacteristicPropertyNotify | CBCharacteristicPropertyIndicate)) {
            [self sendDebugLog:[NSString stringWithFormat:@"   📡 Subscribing to %@", characteristic.UUID]];
            [peripheral setNotifyValue:YES forCharacteristic:characteristic];
        }
        
        if (characteristic.properties & CBCharacteristicPropertyRead) {
            [self sendDebugLog:[NSString stringWithFormat:@"   📖 Reading %@", characteristic.UUID]];
            [peripheral readValueForCharacteristic:characteristic];
        }
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ Char read/update error: %@", error.localizedDescription]];
        return;
    }
    
    NSData *data = characteristic.value;
    NSString *charUUID = characteristic.UUID.UUIDString;
    
    if (data && data.length > 0) {
        NSMutableString *hexString = [NSMutableString stringWithCapacity:data.length * 3];
        const uint8_t *bytes = data.bytes;
        for (int i = 0; i < data.length; i++) {
            [hexString appendFormat:@"%02X ", bytes[i]];
        }
        
        NSString *textValue = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        
        [self sendDebugLog:@"───────────────────────────────────────────"];
        [self sendDebugLog:[NSString stringWithFormat:@"📨 RX from %@:", charUUID]];
        [self sendDebugLog:[NSString stringWithFormat:@"   HEX:   %@", hexString]];
        if (textValue && textValue.length > 0 && textValue.length < 50) {
            [self sendDebugLog:[NSString stringWithFormat:@"   ASCII: %@", textValue]];
        }
        [self sendDebugLog:[NSString stringWithFormat:@"   LEN:   %lu bytes", (unsigned long)data.length]];
        
        NSDictionary *logEntry = @{
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000),
            @"characteristic": charUUID,
            @"hex": hexString,
            @"length": @(data.length)
        };
        [_bg5sRxLog addObject:logEntry];
        
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventSafe:@"onBG5SProtocolData" body:@{
                @"direction": @"RX",
                @"characteristic": charUUID,
                @"hex": hexString,
                @"length": @(data.length),
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
            }];
        });
        
        if ([charUUID.uppercaseString containsString:@"7365"]) {
            [self parseBG5SData:data];
        }
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ BG5S notification error: %@", error.localizedDescription]];
        return;
    }
    
    NSString *charUUID = [characteristic.UUID.UUIDString uppercaseString];
    [self sendDebugLog:[NSString stringWithFormat:@"📡 Notification %@ for %@", 
                       characteristic.isNotifying ? @"ON" : @"OFF", characteristic.UUID]];
    
    if (characteristic.isNotifying && [charUUID containsString:@"7365"]) {
        _bg5sNotificationsEnabled = YES;
        _bg5sMeasurementActive = YES;
        [self sendDebugLog:@"✅ BG5S READY via CoreBluetooth - Insert test strip now"];
        
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
                @"mac": self->_connectedBG5SSerial ?: @"",
                @"type": @"BG5S",
                @"status": @"ready"
            }];
        });
    }
}

- (void)peripheral:(CBPeripheral *)peripheral didWriteValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ BG5S write error: %@", error.localizedDescription]];
    } else {
        [self sendDebugLog:[NSString stringWithFormat:@"✅ BG5S write success for %@", characteristic.UUID]];
    }
}

#pragma mark - BG5S BLE Protocol Parsing (Fallback)

- (void)parseBG5SData:(NSData *)data {
    if (data.length < 2) return;
    
    const uint8_t *bytes = data.bytes;
    uint8_t commandType = bytes[0];
    
    [self sendDebugLog:[NSString stringWithFormat:@"🔬 BG5S parsing - command type: 0x%02X, length: %lu", 
                       commandType, (unsigned long)data.length]];
    
    NSMutableString *hexString = [NSMutableString stringWithCapacity:data.length * 3];
    for (int i = 0; i < data.length; i++) {
        [hexString appendFormat:@"%02X ", bytes[i]];
    }
    [self sendDebugLog:[NSString stringWithFormat:@"   Bytes: %@", hexString]];
    
    // Strip state notifications
    if (commandType == 0x31 || commandType == 0x32) {
        BOOL stripIn = (commandType == 0x31 || (data.length > 1 && bytes[1] == 0x01));
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S: Strip %@", stripIn ? @"INSERTED" : @"REMOVED"]];
        
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
                @"mac": self->_connectedBG5SSerial ?: @"",
                @"type": @"BG5S",
                @"status": stripIn ? @"stripIn" : @"stripOut"
            }];
        });
    }
    // Blood detected
    else if (commandType == 0x33 || commandType == 0x34) {
        [self sendDebugLog:@"🩸 BG5S: Blood detected - measuring..."];
        
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
                @"mac": self->_connectedBG5SSerial ?: @"",
                @"type": @"BG5S",
                @"status": @"bloodDetected"
            }];
        });
    }
    // Glucose result
    else if (commandType == 0x35 || commandType == 0x36 || commandType == 0x40) {
        int glucoseValue = 0;
        if (data.length >= 3) {
            glucoseValue = (bytes[1] << 8) | bytes[2];
            if (glucoseValue > 600 || glucoseValue < 10) {
                glucoseValue = (bytes[2] << 8) | bytes[1];
            }
            if (glucoseValue > 600 || glucoseValue < 10) {
                glucoseValue = bytes[1] > 10 && bytes[1] < 600 ? bytes[1] : bytes[2];
            }
        }
        
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BG5S GLUCOSE RESULT: %d mg/dL", glucoseValue]];
        
        if (glucoseValue >= 10 && glucoseValue <= 600) {
            dispatch_async(dispatch_get_main_queue(), ^{
                [self sendEventSafe:@"onBloodGlucoseReading" body:@{
                    @"mac": self->_connectedBG5SSerial ?: @"",
                    @"type": @"BG5S",
                    @"value": @(glucoseValue),
                    @"unit": @"mg/dL",
                    @"dataID": [[NSUUID UUID] UUIDString],
                    @"source": @"live_ble",
                    @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
                }];
            });
        }
    }
    // Error codes
    else if (commandType == 0xF0 || commandType == 0xFF || commandType == 0xE0) {
        int errorCode = data.length > 1 ? bytes[1] : 0;
        NSString *errorMsg = [self bg5sBleErrorMessage:errorCode];
        
        [self sendDebugLog:[NSString stringWithFormat:@"⚠️ BG5S ERROR: code=%d (%@)", errorCode, errorMsg]];
        
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventSafe:@"onError" body:@{
                @"mac": self->_connectedBG5SSerial ?: @"",
                @"type": @"BG5S",
                @"error": @(errorCode),
                @"message": errorMsg
            }];
        });
    }
    else {
        [self sendDebugLog:[NSString stringWithFormat:@"❓ BG5S unknown command: 0x%02X", commandType]];
    }
}

- (NSString *)bg5sBleErrorMessage:(int)errorCode {
    switch (errorCode) {
        case 0x01: return @"Low battery";
        case 0x02: return @"Temperature error";
        case 0x03: return @"Strip error";
        case 0x04: return @"Blood sample error";
        case 0x05: return @"Strip used";
        case 0x06: return @"Calibration error";
        case 0x07: return @"Result out of range";
        case 0x08: return @"Communication error";
        default: return [NSString stringWithFormat:@"Unknown error (0x%02X)", errorCode];
    }
}

- (void)sendBG5SCommand:(NSData *)command {
    if (!_connectedBG5SPeripheral || !_bg5sWriteChar) {
        [self sendDebugLog:@"❌ Cannot send BG5S command - not connected or no write characteristic"];
        return;
    }
    
    [self sendDebugLog:[NSString stringWithFormat:@"📤 Sending BG5S command: %@", [self hexStringFromData:command]]];
    
    CBCharacteristicWriteType writeType = (_bg5sWriteChar.properties & CBCharacteristicPropertyWriteWithoutResponse) 
        ? CBCharacteristicWriteWithoutResponse 
        : CBCharacteristicWriteWithResponse;
    
    [_connectedBG5SPeripheral writeValue:command forCharacteristic:_bg5sWriteChar type:writeType];
}

#pragma mark - Controller Initialization

- (void)initializeControllers {
    if (_controllersInitialized) {
        [self sendDebugLog:@"🎮 Controllers already initialized"];
        return;
    }
    
    [self sendDebugLog:@"🎮 Initializing device controllers..."];
    
    [BP3LController shareBP3LController];
    [self sendDebugLog:@"🎮 BP3LController initialized"];
    
    [BP5Controller shareBP5Controller];
    [self sendDebugLog:@"🎮 BP5Controller initialized"];
    
    [BP5SController sharedController];
    [self sendDebugLog:@"🎮 BP5SController initialized"];
    
    [HS2Controller shareIHHs2Controller];
    [self sendDebugLog:@"🎮 HS2Controller initialized"];
    
    [HS2SController shareIHHS2SController];
    [self sendDebugLog:@"🎮 HS2SController initialized"];
    
    [HS4Controller shareIHHs4Controller];
    [self sendDebugLog:@"🎮 HS4Controller (HS4S) initialized"];
    
    [BG5Controller shareIHBg5Controller];
    [self sendDebugLog:@"🎮 BG5Controller initialized"];
    
    [BG5SController sharedController];
    [self sendDebugLog:@"🎮 BG5SController initialized"];
    
    _controllersInitialized = YES;
    [self sendDebugLog:@"🎮 All controllers initialized!"];
}

#pragma mark - Device Retrieval

- (BP3L *)getBP3LWithMac:(NSString *)mac {
    BP3LController *controller = [BP3LController shareBP3LController];
    NSArray *devices = [controller getAllCurrentBP3LInstace];
    for (BP3L *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) return device;
    }
    return nil;
}

- (BP5 *)getBP5WithMac:(NSString *)mac {
    BP5Controller *controller = [BP5Controller shareBP5Controller];
    NSArray *devices = [controller getAllCurrentBP5Instace];
    for (BP5 *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) return device;
    }
    return nil;
}

- (BP5S *)getBP5SWithMac:(NSString *)mac {
    BP5SController *controller = [BP5SController sharedController];
    NSArray *devices = [controller getAllCurrentInstance];
    for (BP5S *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) return device;
    }
    return nil;
}

- (HS2 *)getHS2WithMac:(NSString *)mac {
    HS2Controller *controller = [HS2Controller shareIHHs2Controller];
    NSArray *devices = [controller getAllCurrentHS2Instace];
    for (HS2 *device in devices) {
        if ([mac isEqualToString:device.deviceID]) return device;
    }
    return nil;
}

- (HS2S *)getHS2SWithMac:(NSString *)mac {
    HS2SController *controller = [HS2SController shareIHHS2SController];
    NSArray *devices = [controller getAllCurrentHS2SInstace];
    for (HS2S *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) return device;
    }
    return nil;
}

- (HS4 *)getHS4WithMac:(NSString *)mac {
    HS4Controller *controller = [HS4Controller shareIHHs4Controller];
    NSArray *devices = [controller getAllCurrentHS4Instace];
    for (HS4 *device in devices) {
        if ([mac isEqualToString:device.deviceID]) return device;
    }
    return nil;
}

- (BG5 *)getBG5WithMac:(NSString *)mac {
    BG5Controller *controller = [BG5Controller shareIHBg5Controller];
    NSArray *devices = [controller getAllCurrentBG5Instace];
    for (BG5 *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) return device;
    }
    return nil;
}

- (BG5S *)getBG5SWithMac:(NSString *)mac {
    BG5SController *controller = [BG5SController sharedController];
    NSArray *devices = [controller getAllCurrentInstace];
    [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S: Looking for %@ in %lu SDK instances", mac, (unsigned long)devices.count]];
    for (BG5S *device in devices) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S: Checking device serial: %@", device.serialNumber]];
        if ([mac isEqualToString:device.serialNumber]) {
            device.delegate = self;
            return device;
        }
    }
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

    // BG5
    [center addObserver:self selector:@selector(onDiscover:) name:@"BG5Discover" object:nil];
    [center addObserver:self selector:@selector(onConnected:) name:@"BG5ConnectNoti" object:nil];
    [center addObserver:self selector:@selector(onDisconnected:) name:@"BG5DisConnectNoti" object:nil];
    
    // BG5S
    [center addObserver:self selector:@selector(onDiscover:) name:@"BG5SDiscover" object:nil];
    [center addObserver:self selector:@selector(onConnected:) name:@"BG5SConnectNoti" object:nil];
    [center addObserver:self selector:@selector(onDisconnected:) name:@"BG5SDisConnectNoti" object:nil];

    [self sendDebugLog:@"📡 Notification observers registered for all devices"];
}

- (NSString *)typeFromName:(NSString *)name {
    if ([name containsString:@"BP3L"]) return @"BP3L";
    if ([name containsString:@"BP5S"]) return @"BP5S";
    if ([name containsString:@"BP5"]) return @"BP5";
    if ([name containsString:@"HS2S"]) return @"HS2S";
    if ([name containsString:@"HS2"]) return @"HS2";
    if ([name containsString:@"HS4"]) return @"HS4S";
    if ([name containsString:@"BG5S"]) return @"BG5S";
    if ([name containsString:@"BG5"]) return @"BG5";
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

    [self sendDebugLog:@"════════════════════════════════════════════"];
    [self sendDebugLog:[NSString stringWithFormat:@"📡 SDK DISCOVERED: %@ (%@)", mac, type]];
    [self sendDebugLog:[NSString stringWithFormat:@"   Notification: %@", notification.name]];
    [self sendDebugLog:[NSString stringWithFormat:@"   UserInfo: %@", info]];
    [self sendDebugLog:@"════════════════════════════════════════════"];

    [self sendEventSafe:@"onDeviceFound" body:@{
        @"mac": mac,
        @"name": info[@"DeviceName"] ?: type,
        @"type": type,
        @"rssi": info[@"RSSI"] ?: @(-50),
        @"source": @"iHealthSDK"
    }];

    if (_targetMAC && [[mac uppercaseString] isEqualToString:[_targetMAC uppercaseString]]) {
        [self sendDebugLog:@"🎯 TARGET FOUND during scan - initiating connection..."];

        ConnectDeviceController *connector = [ConnectDeviceController commandGetInstance];
        HealthDeviceType deviceType = [self deviceTypeFromString:type];
        int result = [connector commandContectDeviceWithDeviceType:deviceType andSerialNub:mac];

        [self sendDebugLog:[NSString stringWithFormat:@"🔌 Connect command result: %d (0=fail, 1=success)", result]];
    }
}

#pragma mark - Connection Handler

- (void)onConnected:(NSNotification *)notification {
    NSDictionary *info = notification.userInfo;
    NSString *type = [self typeFromName:notification.name];
    NSString *mac = [self getMacFromNotification:notification forType:type];

    [self sendDebugLog:@"════════════════════════════════════════════"];
    [self sendDebugLog:[NSString stringWithFormat:@"🔗 SDK CONNECTED: %@ (%@)", mac, type]];
    [self sendDebugLog:[NSString stringWithFormat:@"   UserInfo keys: %@", info.allKeys]];
    [self sendDebugLog:@"════════════════════════════════════════════"];

    _connectedDevices[mac] = @{@"type": type, @"mac": mac};
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
            BP3L *device = [self getBP3LWithMac:mac];
            if (device) {
                [self handleBP3LConnected:device mac:mac];
            } else {
                [self sendDebugLog:@"❌ BP3L: Could not get device from controller"];
            }
        }
        else if ([type isEqualToString:@"BP5"]) {
            BP5 *device = [self getBP5WithMac:mac];
            if (device) {
                [self handleBP5Connected:device mac:mac];
            } else {
                [self sendDebugLog:@"❌ BP5: Could not get device from controller"];
            }
        }
        else if ([type isEqualToString:@"BP5S"]) {
            BP5S *device = [self getBP5SWithMac:mac];
            if (device) {
                [self handleBP5SConnected:device mac:mac];
            } else {
                [self sendDebugLog:@"❌ BP5S: Could not get device from controller"];
            }
        }
        else if ([type isEqualToString:@"HS2"]) {
            HS2 *device = [self getHS2WithMac:mac];
            if (device) {
                [self handleHS2Connected:device mac:mac];
            } else {
                [self sendDebugLog:@"❌ HS2: Could not get device from controller"];
            }
        }
        else if ([type isEqualToString:@"HS2S"]) {
            HS2S *device = [self getHS2SWithMac:mac];
            if (device) {
                [self handleHS2SConnected:device mac:mac];
            } else {
                [self sendDebugLog:@"❌ HS2S: Could not get device from controller"];
            }
        }
        else if ([type isEqualToString:@"HS4S"]) {
            HS4 *device = [self getHS4WithMac:mac];
            if (device) {
                [self handleHS4Connected:device mac:mac];
            } else {
                [self sendDebugLog:@"❌ HS4S: Could not get device from controller"];
            }
        }
        else if ([type isEqualToString:@"BG5"]) {
            BG5 *device = [self getBG5WithMac:mac];
            if (device) {
                [self handleBG5Connected:device mac:mac];
            } else {
                [self sendDebugLog:@"❌ BG5: Could not get device from controller"];
            }
        }
        else if ([type isEqualToString:@"BG5S"]) {
            BG5S *device = [self getBG5SWithMac:mac];
            if (device) {
                [self sendDebugLog:@"✅ BG5S: Got device from SDK controller!"];
                [self handleBG5SConnected:device mac:mac];
            } else {
                [self sendDebugLog:@"❌ BG5S: Could not get device from SDK controller"];
            }
        }
    });
}

- (void)onDisconnected:(NSNotification *)notification {
    NSDictionary *info = notification.userInfo;
    NSString *type = [self typeFromName:notification.name];
    NSString *mac = [self getMacFromNotification:notification forType:type];
    
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 DISCONNECTED: %@ (%@)", mac, type]];
    [_connectedDevices removeObjectForKey:mac];
    
    [self sendEventSafe:@"onConnectionStateChanged" body:@{
        @"mac": mac,
        @"type": type,
        @"connected": @NO
    }];
}

#pragma mark - BP3L Handling

- (void)handleBP3LConnected:(BP3L *)bp mac:(NSString *)mac {
    [self sendDebugLog:@"🩺 BP3L: Starting measurement automatically..."];

    [bp commandStartMeasureWithZeroingState:^(BOOL isComplete) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP3L zeroing: %@", isComplete ? @"complete" : @"in progress"]];
    } pressure:^(NSArray *pressureArray) {
        if (pressureArray.count > 0) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP3L pressure: %@ mmHg", pressureArray.firstObject]];
        }
    } waveletWithHeartbeat:^(NSArray *wavelet) {
        [self sendDebugLog:@"🩺 BP3L: heartbeat detected"];
    } waveletWithoutHeartbeat:^(NSArray *wavelet) {
    } result:^(NSDictionary *resultDic) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BP3L RESULT: %@", resultDic]];

        NSNumber *sys = resultDic[@"sys"] ?: @0;
        NSNumber *dia = resultDic[@"dia"] ?: @0;
        NSNumber *hr = resultDic[@"heartRate"] ?: @0;
        NSNumber *irregular = resultDic[@"irregular"] ?: @NO;

        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": mac,
            @"type": @"BP3L",
            @"systolic": sys,
            @"diastolic": dia,
            @"pulse": hr,
            @"irregular": irregular,
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } errorBlock:^(BPDeviceError error) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP3L error: %d", (int)error]];
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BP3L", @"error": @(error), @"message": [self bpErrorMessage:error]}];
    }];
}

#pragma mark - BP5 Handling

- (void)handleBP5Connected:(BP5 *)bp mac:(NSString *)mac {
    [self sendDebugLog:@"🩺 BP5: Starting measurement..."];

    [bp commandStartMeasureWithZeroingState:^(BOOL isComplete) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP5 zeroing: %@", isComplete ? @"complete" : @"in progress"]];
    } pressure:^(NSArray *pressureArray) {
        if (pressureArray.count > 0) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP5 pressure: %@ mmHg", pressureArray.firstObject]];
        }
    } waveletWithHeartbeat:^(NSArray *wavelet) {
        [self sendDebugLog:@"🩺 BP5: heartbeat detected"];
    } waveletWithoutHeartbeat:^(NSArray *wavelet) {
    } result:^(NSDictionary *resultDic) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BP5 RESULT: %@", resultDic]];

        NSNumber *sys = resultDic[@"sys"] ?: @0;
        NSNumber *dia = resultDic[@"dia"] ?: @0;
        NSNumber *hr = resultDic[@"heartRate"] ?: @0;
        NSNumber *irregular = resultDic[@"irregular"] ?: @NO;

        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": mac,
            @"type": @"BP5",
            @"systolic": sys,
            @"diastolic": dia,
            @"pulse": hr,
            @"irregular": irregular,
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } errorBlock:^(BPDeviceError error) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP5 error: %d", (int)error]];
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BP5", @"error": @(error), @"message": [self bpErrorMessage:error]}];
    }];
}

#pragma mark - BP5S Handling

- (void)handleBP5SConnected:(BP5S *)bp mac:(NSString *)mac {
    [self sendDebugLog:@"🩺 BP5S: Starting measurement..."];

    [bp commandStartMeasureWithZeroingState:^(BOOL isComplete) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP5S zeroing: %@", isComplete ? @"complete" : @"in progress"]];
    } pressure:^(NSArray *pressureArray) {
        if (pressureArray.count > 0) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP5S pressure: %@ mmHg", pressureArray.firstObject]];
        }
    } waveletWithHeartbeat:^(NSArray *wavelet) {
        [self sendDebugLog:@"🩺 BP5S: heartbeat detected"];
    } waveletWithoutHeartbeat:^(NSArray *wavelet) {
    } result:^(NSDictionary *resultDic) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BP5S RESULT: %@", resultDic]];

        NSNumber *sys = resultDic[@"sys"] ?: @0;
        NSNumber *dia = resultDic[@"dia"] ?: @0;
        NSNumber *hr = resultDic[@"heartRate"] ?: @0;
        NSNumber *irregular = resultDic[@"irregular"] ?: @NO;

        [self sendEventSafe:@"onBloodPressureReading" body:@{
            @"mac": mac,
            @"type": @"BP5S",
            @"systolic": sys,
            @"diastolic": dia,
            @"pulse": hr,
            @"irregular": irregular,
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } errorBlock:^(BPDeviceError error) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP5S error: %d", (int)error]];
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BP5S", @"error": @(error), @"message": [self bpErrorMessage:error]}];
    }];
}

#pragma mark - HS2 Scale Handling

- (void)handleHS2Connected:(HS2 *)scale mac:(NSString *)mac {
    [self sendDebugLog:@"⚖️ HS2: Getting battery and starting measurement..."];

    [scale commandGetHS2Battery:^(NSNumber *battery) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2 battery: %@%%", battery]];
    } DiaposeErrorBlock:^(HS2DeviceError error) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2 battery error: %d", (int)error]];
    }];

    [scale commandHS2MeasureWithUint:HSUnit_Kg Weight:^(NSNumber *unStableWeight) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2 measuring: %@ kg", unStableWeight]];
    } StableWeight:^(NSDictionary *stableWeightDic) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 HS2 STABLE: %@", stableWeightDic]];
        
        NSNumber *weight = stableWeightDic[@"Weight"] ?: @0;
        NSString *dataID = stableWeightDic[@"dataID"] ?: @"";
        
        [self sendEventSafe:@"onWeightReading" body:@{
            @"mac": mac,
            @"type": @"HS2",
            @"weight": weight,
            @"unit": @"kg",
            @"dataID": dataID,
            @"source": @"live",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } DisposeErrorBlock:^(HS2DeviceError error) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2 measure error: %d", (int)error]];
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"HS2", @"error": @(error), @"message": [self hsErrorMessage:error]}];
    }];
}

#pragma mark - HS2S Scale Handling

- (void)handleHS2SConnected:(HS2S *)scale mac:(NSString *)mac {
    [self sendDebugLog:@"⚖️ HS2S: Getting device info (this syncs time)..."];

    [scale commandGetHS2SDeviceInfo:^(NSDictionary *deviceInfo) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S info: %@", deviceInfo]];

        [self sendDebugLog:@"⚖️ HS2S: Checking anonymous memory..."];
        [scale commandGetHS2SAnonymousMemoryDataCount:^(NSNumber *count) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S: Anonymous memory count: %@", count]];

            if ([count intValue] > 0) {
                [self fetchHS2SAnonymousData:scale mac:mac];
            } else {
                [self startHS2SLiveMeasurement:scale mac:mac];
            }
        } DiaposeErrorBlock:^(HS2SDeviceError error) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S count error: %d - starting live measurement", (int)error]];
            [self startHS2SLiveMeasurement:scale mac:mac];
        }];

    } DiaposeErrorBlock:^(HS2SDeviceError error) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S info error: %d", (int)error]];
        [self startHS2SLiveMeasurement:scale mac:mac];
    }];
}

- (void)fetchHS2SAnonymousData:(HS2S *)scale mac:(NSString *)mac {
    [self sendDebugLog:@"⚖️ HS2S: Fetching anonymous memory data..."];
    
    [scale commandGetHS2SAnonymousMemoryData:^(NSArray *memoryData) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S: Got %lu anonymous records", (unsigned long)memoryData.count]];

        for (NSDictionary *record in memoryData) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S record: %@", record]];
            NSNumber *weight = record[@"HS2SWeigthResult"] ?: record[@"Weight"] ?: record[@"weight"] ?: @0;
            
            [self sendEventSafe:@"onWeightReading" body:@{
                @"mac": mac,
                @"type": @"HS2S",
                @"weight": weight,
                @"unit": @"kg",
                @"source": @"anonymous_memory",
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
            }];
        }

        [scale commandDeleteHS2SAnonymousMemoryData:^(BOOL success) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S: Cleared anonymous memory: %@", success ? @"YES" : @"NO"]];
        } DiaposeErrorBlock:^(HS2SDeviceError error) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S: Clear error: %d", (int)error]];
        }];

        [self startHS2SLiveMeasurement:scale mac:mac];
        
    } DiaposeErrorBlock:^(HS2SDeviceError error) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S fetch error: %d", (int)error]];
        [self startHS2SLiveMeasurement:scale mac:mac];
    }];
}

- (void)startHS2SLiveMeasurement:(HS2S *)scale mac:(NSString *)mac {
    [self sendDebugLog:@"⚖️ HS2S: Starting live measurement - STEP ON SCALE NOW!"];

    HealthUser *user = [[HealthUser alloc] init];
    user.userType = UserType_Guest;
    user.height = @170;
    user.weight = @70;
    user.age = @30;
    user.sex = UserSex_Male;
    user.impedanceMark = HS2SImpedanceMark_NO;

    [scale commandStartHS2SMeasureWithUser:user
        weight:^(NSNumber *unStableWeight) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S measuring: %@ kg", unStableWeight]];
        }
        stableWeight:^(NSNumber *stableWeight) {
            [self sendDebugLog:[NSString stringWithFormat:@"🎉 HS2S STABLE WEIGHT: %@ kg", stableWeight]];
            [self sendEventSafe:@"onWeightReading" body:@{
                @"mac": mac,
                @"type": @"HS2S",
                @"weight": stableWeight ?: @0,
                @"unit": @"kg",
                @"source": @"live",
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
            }];
        }
        weightAndBodyInfo:^(NSDictionary *bodyInfo) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S body info: %@", bodyInfo]];
            
            NSNumber *weight = bodyInfo[@"HS2SWeigthResult"] ?: @0;
            NSNumber *bodyWeightFlag = bodyInfo[@"HS2SBodyWeightFlag"] ?: @0;
            
            NSMutableDictionary *result = [@{
                @"mac": mac,
                @"type": @"HS2S",
                @"weight": weight,
                @"unit": @"kg",
                @"source": @"live_body",
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
            } mutableCopy];
            
            if ([bodyWeightFlag intValue] == 1) {
                if (bodyInfo[@"HS2SFatResult"]) result[@"fat"] = bodyInfo[@"HS2SFatResult"];
                if (bodyInfo[@"HS2SMuscleResult"]) result[@"muscle"] = bodyInfo[@"HS2SMuscleResult"];
                if (bodyInfo[@"HS2SWaterResult"]) result[@"water"] = bodyInfo[@"HS2SWaterResult"];
                if (bodyInfo[@"HS2SSkeletonResult"]) result[@"bone"] = bodyInfo[@"HS2SSkeletonResult"];
                if (bodyInfo[@"HS2SVFLResult"]) result[@"visceralFat"] = bodyInfo[@"HS2SVFLResult"];
                if (bodyInfo[@"HS2SDCIResult"]) result[@"dci"] = bodyInfo[@"HS2SDCIResult"];
            }
            
            [self sendEventSafe:@"onWeightReading" body:result];
        }
        disposeHS2SMeasureFinish:^{
            [self sendDebugLog:@"⚖️ HS2S: Measurement complete"];
        }
        DiaposeErrorBlock:^(HS2SDeviceError error) {
            [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2S measure error: %d", (int)error]];
            [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"HS2S", @"error": @(error)}];
        }];
}

#pragma mark - HS4 (HS4S) Scale Handling

- (void)handleHS4Connected:(HS4 *)scale mac:(NSString *)mac {
    [self sendDebugLog:@"⚖️ HS4S: Starting measurement..."];

    [scale commandMeasureWithUint:1 Weight:^(NSNumber *unStableWeight) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS4S measuring: %@ kg", unStableWeight]];
    } StableWeight:^(NSDictionary *stableWeightDic) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 HS4S STABLE: %@", stableWeightDic]];
        
        NSNumber *weight = stableWeightDic[@"Weight"] ?: @0;
        NSString *dataID = stableWeightDic[@"dataID"] ?: @"";
        
        [self sendEventSafe:@"onWeightReading" body:@{
            @"mac": mac,
            @"type": @"HS4S",
            @"weight": weight,
            @"unit": @"kg",
            @"dataID": dataID,
            @"source": @"live",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    } DisposeErrorBlock:^(HS4DeviceError error) {
        [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS4S error: %d", (int)error]];
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"HS4S", @"error": @(error)}];
    }];
}

#pragma mark - BG5 Handling

- (void)handleBG5Connected:(BG5 *)bg mac:(NSString *)mac {
    [self sendDebugLog:@"🩸 BG5: Connected - setting time first..."];
    
    NSMutableDictionary *deviceInfo = [_connectedDevices[mac] mutableCopy];
    if (deviceInfo) {
        deviceInfo[@"bg5_device"] = bg;
        _connectedDevices[mac] = deviceInfo;
    }
    
    [bg commandBGSetTime:^(BOOL setResult) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 time set: %@", setResult ? @"YES" : @"NO"]];
        
        [bg commandQueryBattery:^(NSNumber *energy) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 battery: %@%%", energy]];
        } DisposeErrorBlock:^(NSNumber *errorID) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 battery error: %@", errorID]];
        }];
        
        [self sendDebugLog:@"🩸 BG5: Ready - scan bottle QR code then insert test strip"];
        [self fetchBG5OfflineData:bg mac:mac];
        
    } DisposeBGErrorBlock:^(NSNumber *errorID) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 time set error: %@", errorID]];
    }];
}

RCT_EXPORT_METHOD(setBottleCode:(NSString *)mac
                  bottleCode:(NSString *)bottleCode
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5: Setting bottle code for %@", mac]];
    [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5: Code: %@", bottleCode]];
    
    NSDictionary *info = _connectedDevices[mac];
    NSString *type = info[@"type"];
    
    if (![type isEqualToString:@"BG5"]) {
        [self sendDebugLog:@"🩸 setBottleCode only applies to BG5 devices"];
        resolve(@NO);
        return;
    }
    
    BG5 *device = [self getBG5WithMac:mac];
    if (!device) {
        [self sendDebugLog:@"🩸 BG5 device not found in controller"];
        reject(@"NOT_FOUND", @"BG5 device not connected", nil);
        return;
    }
    
    NSDictionary *bottleInfo = [device codeStripStrAnalysis:bottleCode];
    if (bottleInfo) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5: Parsed bottle info: %@", bottleInfo]];
    }
    
    NSNumber *stripNum = bottleInfo[@"StripNum"] ?: @25;
    NSDate *dueDate = bottleInfo[@"DueDate"] ?: [[NSDate date] dateByAddingTimeInterval:365*24*60*60];
    
    [device commandSendBGCodeWithMeasureType:BGMeasureMode_Blood
                                    CodeType:BGCodeMode_GOD
                                  CodeString:bottleCode
                                   validDate:dueDate
                                   remainNum:stripNum
                      DisposeBGSendCodeBlock:^(BOOL sendOk) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 code sent: %@", sendOk ? @"SUCCESS" : @"FAILED"]];
        if (sendOk) {
            resolve(@YES);
        } else {
            resolve(@NO);
        }
    }
                         DisposeBGStartModel:^(BGOpenMode mode) {
        if (mode == BGOpenMode_Strip) {
            [self sendDebugLog:@"🩸 BG5: Strip-boot mode - INSERT TEST STRIP to begin"];
            [self setupBG5StripMeasurement:device mac:mac];
        } else if (mode == BGOpenMode_Hand) {
            [self sendDebugLog:@"🩸 BG5: Button-boot mode - ready for measurement"];
            [self setupBG5HandMeasurement:device mac:mac];
        }
    }
                         DisposeBGErrorBlock:^(NSNumber *errorID) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 send code error: %@", errorID]];
        [self sendEventSafe:@"onError" body:@{
            @"mac": mac,
            @"type": @"BG5",
            @"error": errorID,
            @"message": [self bg5ErrorMessage:[errorID intValue]]
        }];
        resolve(@NO);
    }];
}

- (void)setupBG5StripMeasurement:(BG5 *)device mac:(NSString *)mac {
    [device commandCreateBGtestStripInBlock:^{
        [self sendDebugLog:@"🩸 BG5: Strip inserted - waiting for blood"];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{@"mac": mac, @"type": @"BG5", @"status": @"stripIn"}];
    }
                        DisposeBGBloodBlock:^{
        [self sendDebugLog:@"🩸 BG5: Blood detected - measuring..."];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{@"mac": mac, @"type": @"BG5", @"status": @"bloodDetected"}];
    }
                       DisposeBGResultBlock:^(NSDictionary *result) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BG5 RESULT: %@", result]];
        
        NSNumber *value = result[@"Result"] ?: @0;
        NSString *dataID = result[@"DataID"] ?: [[NSUUID UUID] UUIDString];
        
        [self sendEventSafe:@"onBloodGlucoseReading" body:@{
            @"mac": mac, @"type": @"BG5", @"value": value, @"unit": @"mg/dL",
            @"dataID": dataID, @"source": @"live",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    }
                        DisposeBGErrorBlock:^(NSNumber *errorID) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 measurement error: %@", errorID]];
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BG5", @"error": errorID, @"message": [self bg5ErrorMessage:[errorID intValue]]}];
    }];
}

- (void)setupBG5HandMeasurement:(BG5 *)device mac:(NSString *)mac {
    [device commandCreateBGtestModel:BGMeasureMode_Blood
               DisposeBGStripInBlock:^{
        [self sendDebugLog:@"🩸 BG5: Strip inserted - waiting for blood"];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{@"mac": mac, @"type": @"BG5", @"status": @"stripIn"}];
    }
                 DisposeBGBloodBlock:^{
        [self sendDebugLog:@"🩸 BG5: Blood detected - measuring..."];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{@"mac": mac, @"type": @"BG5", @"status": @"bloodDetected"}];
    }
                DisposeBGResultBlock:^(NSDictionary *result) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BG5 RESULT: %@", result]];
        
        NSNumber *value = result[@"Result"] ?: @0;
        NSString *dataID = result[@"DataID"] ?: [[NSUUID UUID] UUIDString];
        
        [self sendEventSafe:@"onBloodGlucoseReading" body:@{
            @"mac": mac, @"type": @"BG5", @"value": value, @"unit": @"mg/dL",
            @"dataID": dataID, @"source": @"live",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    }
                 DisposeBGErrorBlock:^(NSNumber *errorID) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 measurement error: %@", errorID]];
        [self sendEventSafe:@"onError" body:@{@"mac": mac, @"type": @"BG5", @"error": errorID, @"message": [self bg5ErrorMessage:[errorID intValue]]}];
    }];
}

- (NSString *)bg5ErrorMessage:(int)errorCode {
    switch (errorCode) {
        case 0: return @"Low battery";
        case 1: return @"Result out of measurement range";
        case 2: return @"Reference voltage error";
        case 3: return @"Strip used or moisture detected";
        case 4: return @"EEPROM error";
        case 5: return @"Temperature too low";
        case 6: return @"Temperature too high";
        case 7: return @"Test strip coding error";
        case 8: return @"Test strip coding error";
        case 9: return @"Strip removed during measurement";
        case 10: return @"Pull off strip after reading";
        case 11: return @"Cannot write SN or key";
        case 12: return @"Please set time first";
        case 13: return @"No strips remaining";
        case 14: return @"Test strip expired";
        case 15: return @"Cannot measure while charging";
        default: return [NSString stringWithFormat:@"Error code: %d", errorCode];
    }
}

- (void)fetchBG5OfflineData:(BG5 *)bg mac:(NSString *)mac {
    [self sendDebugLog:@"🩸 BG5: Fetching offline data..."];
    
    [bg commandTransferMemorryData:^(NSNumber *dataCount) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 offline count: %@", dataCount]];
    } DisposeBGHistoryData:^(NSDictionary *historyDataDic) {
        NSArray *historyArr = historyDataDic[@"ResultList"] ?: @[];
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 offline records: %lu", (unsigned long)historyArr.count]];
        
        for (NSDictionary *record in historyArr) {
            NSNumber *value = record[@"Result"] ?: @0;
            NSDate *date = record[@"Date"];
            NSString *dataID = record[@"dataID"] ?: @"";
            
            [self sendEventSafe:@"onBloodGlucoseReading" body:@{
                @"mac": mac, @"type": @"BG5", @"value": value, @"unit": @"mg/dL",
                @"dataID": dataID, @"source": @"offline",
                @"timestamp": date ? @([date timeIntervalSince1970] * 1000) : @([[NSDate date] timeIntervalSince1970] * 1000)
            }];
        }
    } DisposeBGErrorBlock:^(NSNumber *errorID) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 offline error: %@", errorID]];
    }];
}

#pragma mark - BG5S Handling

- (void)handleBG5SConnected:(BG5S *)bg mac:(NSString *)mac {
    [self sendDebugLog:@"🩸 BG5S: Connected via SDK - setting up delegate and querying status..."];
    
    bg.delegate = self;
    
    [bg queryStateInfoWithSuccess:^(BG5SStateInfo *stateInfo) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S status - battery: %d%%, strips used: %d, offline: %d",
                           (int)stateInfo.batteryValue,
                           (int)stateInfo.stripUsedValue,
                           (int)stateInfo.offlineDataQuantity]];
        
        [bg setTimeWithDate:[NSDate date] timezone:[[NSTimeZone localTimeZone] secondsFromGMT] / 3600.0 successBlock:^{
            [self sendDebugLog:@"🩸 BG5S time synced"];
        } errorBlock:^(BG5SError error, NSString *detailInfo) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S time sync error: %d", (int)error]];
        }];
        
        if (stateInfo.offlineDataQuantity > 0) {
            [self fetchBG5SOfflineData:bg mac:mac];
        }
        
        [self sendDebugLog:@"🩸 BG5S: Starting measurement mode..."];
        [bg startMeasure:BGMeasureMode_Blood withSuccessBlock:^{
            [self sendDebugLog:@"🩸 BG5S: Measurement mode started - INSERT TEST STRIP to begin"];
        } errorBlock:^(BG5SError error, NSString *detailInfo) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S startMeasure error: %d - %@", (int)error, detailInfo]];
        }];
        
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S status error: %d - %@", (int)error, detailInfo]];
        
        [bg startMeasure:BGMeasureMode_Blood withSuccessBlock:^{
            [self sendDebugLog:@"🩸 BG5S: Measurement mode started after status error"];
        } errorBlock:^(BG5SError error2, NSString *detailInfo2) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S startMeasure error: %d", (int)error2]];
        }];
    }];
}

- (void)fetchBG5SOfflineData:(BG5S *)bg mac:(NSString *)mac {
    [self sendDebugLog:@"🩸 BG5S: Fetching offline data..."];
    
    [bg queryRecordWithSuccessBlock:^(NSArray *array) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S offline records: %lu", (unsigned long)array.count]];
        
        for (BG5SRecordModel *record in array) {
            [self sendEventSafe:@"onBloodGlucoseReading" body:@{
                @"mac": mac, @"type": @"BG5S", @"value": @(record.value), @"unit": @"mg/dL",
                @"dataID": record.dataID ?: @"", @"source": @"offline",
                @"timestamp": record.measureDate ? @([record.measureDate timeIntervalSince1970] * 1000) : @([[NSDate date] timeIntervalSince1970] * 1000)
            }];
        }
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S offline error: %d - %@", (int)error, detailInfo]];
    }];
}

#pragma mark - BG5SDelegate Methods

- (void)device:(BG5S *)device occurError:(BG5SError)error errorDescription:(NSString *)errorDescription {
    [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S error: %d - %@", (int)error, errorDescription]];
    NSString *mac = device.serialNumber;
    [self sendEventSafe:@"onError" body:@{
        @"mac": mac ?: @"", @"type": @"BG5S", @"error": @(error),
        @"message": errorDescription ?: @"Unknown error"
    }];
}

- (void)device:(BG5S *)device stripStateDidUpdate:(BG5SStripState)state {
    NSString *mac = device.serialNumber;
    if (state == BG5SStripState_Insert) {
        [self sendDebugLog:@"🩸 BG5S: Strip INSERTED - apply blood sample"];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{@"mac": mac ?: @"", @"type": @"BG5S", @"status": @"stripIn"}];
    } else {
        [self sendDebugLog:@"🩸 BG5S: Strip REMOVED"];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{@"mac": mac ?: @"", @"type": @"BG5S", @"status": @"stripOut"}];
    }
}

- (void)deviceDropBlood:(BG5S *)device {
    NSString *mac = device.serialNumber;
    [self sendDebugLog:@"🩸 BG5S: Blood detected - measuring..."];
    [self sendEventSafe:@"onBloodGlucoseStatus" body:@{@"mac": mac ?: @"", @"type": @"BG5S", @"status": @"bloodDetected"}];
}

- (void)device:(BG5S *)device dataID:(NSString *)dataID measureReult:(NSInteger)result {
    NSString *mac = device.serialNumber;
    [self sendDebugLog:[NSString stringWithFormat:@"🎉 BG5S RESULT: %ld mg/dL (dataID: %@)", (long)result, dataID]];
    
    [self sendEventSafe:@"onBloodGlucoseReading" body:@{
        @"mac": mac ?: @"", @"type": @"BG5S", @"value": @(result), @"unit": @"mg/dL",
        @"dataID": dataID ?: @"", @"source": @"live",
        @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
    }];
}

- (void)device:(BG5S *)device chargeStateDidUpdate:(BG5SChargeState)state {
    [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S charge state: %@", state == BG5SChargeState_Charging ? @"charging" : @"not charging"]];
}

#pragma mark - Error Message Helpers

- (NSString *)bpErrorMessage:(BPDeviceError)error {
    switch (error) {
        case 0: return @"Unable to find zero point";
        case 1: return @"Unable to find systolic pressure";
        case 2: return @"Unable to find diastolic pressure";
        case 3: return @"Pressurization too fast";
        case 4: return @"Pressurization too slow";
        case 5: return @"Pressure exceeds 300mmHg";
        case 6: return @"Measurement timeout";
        case 12: return @"Connection error";
        case 13: return @"Low battery";
        case 17: return @"Arm moved during measurement";
        default: return [NSString stringWithFormat:@"Error code: %d", (int)error];
    }
}

- (NSString *)hsErrorMessage:(HS2DeviceError)error {
    switch (error) {
        case 1: return @"Battery low";
        case 2: return @"Scale failed to initialize";
        case 3: return @"Maximum weight exceeded";
        case 4: return @"Cannot capture steady reading";
        case 5: return @"Bluetooth connection error";
        case 6: return @"Movement during measurement";
        case 9: return @"No history data";
        case 10: return @"Device disconnected";
        default: return [NSString stringWithFormat:@"Error code: %d", (int)error];
    }
}

#pragma mark - Authentication

RCT_EXPORT_METHOD(authenticate:(NSString *)licensePath
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:@"🔑 Auth: Starting authentication..."];

    NSString *path = [[NSBundle mainBundle] pathForResource:@"license" ofType:@"pem"];
    if (!path) {
        [self sendDebugLog:@"🔑 Auth: license.pem NOT FOUND in bundle"];
        reject(@"NO_LICENSE", @"license.pem not found", nil);
        return;
    }

    NSData *licenseData = [NSData dataWithContentsOfFile:path];
    [self sendDebugLog:[NSString stringWithFormat:@"🔑 Auth: License loaded (%lu bytes)", (unsigned long)licenseData.length]];

    [[IHSDKCloudUser commandGetSDKUserInstance]
        commandSDKUserValidationWithLicense:licenseData
        UserDeviceAccess:^(NSArray *devices) {
            [self sendDebugLog:[NSString stringWithFormat:@"🔑 Auth: Device access granted: %@", devices]];
        }
        UserValidationSuccess:^(UserAuthenResult result) {
            [self sendDebugLog:[NSString stringWithFormat:@"🔑 Auth: SUCCESS (result=%d)", (int)result]];
            self->_isAuthenticated = YES;
            [self initializeControllers];
            resolve(@YES);
        }
        DisposeErrorBlock:^(UserAuthenResult error) {
            [self sendDebugLog:[NSString stringWithFormat:@"🔑 Auth: Error=%d (continuing in trial mode)", (int)error]];
            self->_isAuthenticated = YES;
            [self initializeControllers];
            resolve(@YES);
        }];
}

RCT_EXPORT_METHOD(isAuthenticated:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(@(_isAuthenticated));
}

#pragma mark - Scanning

RCT_EXPORT_METHOD(startScan:(NSArray *)deviceTypes
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"📶 Scan: Starting for %@", deviceTypes]];
    
    if (!_controllersInitialized) {
        [self sendDebugLog:@"📶 Scan: Controllers not initialized - initializing now..."];
        [self initializeControllers];
    }

    ScanDeviceController *scanner = [ScanDeviceController commandGetInstance];

    // *** KEY CHANGE: No more BG5S bypass - let SDK scan handle it ***
    for (NSString *type in deviceTypes) {
        HealthDeviceType dt = [self deviceTypeFromString:type];
        [self sendDebugLog:[NSString stringWithFormat:@"📶 Scan: Starting SDK scan for %@ (enum=%d)", type, (int)dt]];
        int result = [scanner commandScanDeviceType:dt];
        [self sendDebugLog:[NSString stringWithFormat:@"📶 Scan: %@ result=%d (1=success)", type, result]];
    }

    [self sendEventSafe:@"onScanStateChanged" body:@{@"scanning": @YES}];
    resolve(nil);
}

RCT_EXPORT_METHOD(stopScan:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:@"📶 Scan: Stopping all scans"];
    
    [self stopCoreBluetoothScan];
    
    ScanDeviceController *scanner = [ScanDeviceController commandGetInstance];
    
    [scanner commandStopScanDeviceType:HealthDeviceType_BP3L];
    [scanner commandStopScanDeviceType:HealthDeviceType_BP5];
    [scanner commandStopScanDeviceType:HealthDeviceType_BP5S];
    [scanner commandStopScanDeviceType:HealthDeviceType_HS2];
    [scanner commandStopScanDeviceType:HealthDeviceType_HS2S];
    [scanner commandStopScanDeviceType:HealthDeviceType_HS4];
    [scanner commandStopScanDeviceType:HealthDeviceType_BG5];
    [scanner commandStopScanDeviceType:HealthDeviceType_BG5S];
    
    [self sendEventSafe:@"onScanStateChanged" body:@{@"scanning": @NO}];
    resolve(nil);
}

#pragma mark - Connection

RCT_EXPORT_METHOD(connectDevice:(NSString *)mac
                  deviceType:(NSString *)deviceType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 Connect: Initiating connection to %@ (%@)", mac, deviceType]];

    _targetMAC = mac;
    _targetType = deviceType;

    // Use SDK connection for all devices including BG5S
    ConnectDeviceController *connector = [ConnectDeviceController commandGetInstance];
    HealthDeviceType dt = [self deviceTypeFromString:deviceType];
    int result = [connector commandContectDeviceWithDeviceType:dt andSerialNub:mac];
    
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 Connect command result: %d (1=success, 0=fail)", result]];
    
    if (result == 1) {
        resolve(@YES);
    } else {
        [self sendDebugLog:@"🔌 Connect: Failed - device may not be in range or not advertising"];
        
        // Fallback to CoreBluetooth for BG5S if SDK connect fails
        if ([deviceType isEqualToString:@"BG5S"]) {
            [self sendDebugLog:@"🔌 BG5S: SDK connect failed, trying CoreBluetooth fallback..."];
            CBPeripheral *peripheral = [self findBG5SPeripheralBySerial:mac];
            if (peripheral) {
                [self connectBG5SPeripheral:peripheral serial:mac];
                resolve(@YES);
                return;
            } else {
                [self sendDebugLog:@"🔌 BG5S: No cached peripheral, starting CoreBluetooth scan..."];
                _scanningForBG5S = YES;
                [self startCoreBluetoothScanForBG5S];
                resolve(@YES);
                return;
            }
        }
        
        resolve(@NO);
    }
}

RCT_EXPORT_METHOD(disconnectDevice:(NSString *)mac
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 Disconnect: %@", mac]];
    
    NSDictionary *info = _connectedDevices[mac];
    NSString *type = info[@"type"];
    
    if ([type isEqualToString:@"BP3L"]) {
        BP3L *device = [self getBP3LWithMac:mac];
        if (device) [device commandDisconnectDevice];
    }
    else if ([type isEqualToString:@"BP5S"]) {
        BP5S *device = [self getBP5SWithMac:mac];
        if (device) [device commandDisconnectDevice];
    }
    else if ([type isEqualToString:@"BG5S"]) {
        BG5S *device = [self getBG5SWithMac:mac];
        if (device) [device disconnectDevice];
        if (_connectedBG5SPeripheral) {
            [_centralManager cancelPeripheralConnection:_connectedBG5SPeripheral];
            _connectedBG5SPeripheral = nil;
            _connectedBG5SSerial = nil;
        }
    }
    else if ([type isEqualToString:@"HS2"]) {
        HS2 *device = [self getHS2WithMac:mac];
        if (device) [device commandDisconnectDevice];
    }
    
    [_connectedDevices removeObjectForKey:mac];
    resolve(nil);
}

RCT_EXPORT_METHOD(disconnectAll:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:@"🔌 Disconnect: All devices"];
    
    for (NSString *mac in _connectedDevices.allKeys.copy) {
        NSDictionary *info = _connectedDevices[mac];
        NSString *type = info[@"type"];
        
        if ([type isEqualToString:@"BP3L"]) {
            BP3L *device = [self getBP3LWithMac:mac];
            if (device) [device commandDisconnectDevice];
        }
        else if ([type isEqualToString:@"BP5S"]) {
            BP5S *device = [self getBP5SWithMac:mac];
            if (device) [device commandDisconnectDevice];
        }
        else if ([type isEqualToString:@"BG5S"]) {
            BG5S *device = [self getBG5SWithMac:mac];
            if (device) [device disconnectDevice];
        }
        else if ([type isEqualToString:@"HS2"]) {
            HS2 *device = [self getHS2WithMac:mac];
            if (device) [device commandDisconnectDevice];
        }
    }
    
    if (_connectedBG5SPeripheral) {
        [_centralManager cancelPeripheralConnection:_connectedBG5SPeripheral];
        _connectedBG5SPeripheral = nil;
        _connectedBG5SSerial = nil;
    }
    
    [_connectedDevices removeAllObjects];
    _targetMAC = nil;
    _targetType = nil;
    resolve(nil);
}

#pragma mark - Measurement Control

RCT_EXPORT_METHOD(startMeasurement:(NSString *)mac
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"📊 startMeasurement: %@", mac]];
    
    NSDictionary *info = _connectedDevices[mac];
    NSString *type = info[@"type"];
    
    if ([type isEqualToString:@"BP3L"]) {
        BP3L *device = [self getBP3LWithMac:mac];
        if (device) [self handleBP3LConnected:device mac:mac];
    }
    else if ([type isEqualToString:@"BP5"]) {
        BP5 *device = [self getBP5WithMac:mac];
        if (device) [self handleBP5Connected:device mac:mac];
    }
    else if ([type isEqualToString:@"BP5S"]) {
        BP5S *device = [self getBP5SWithMac:mac];
        if (device) [self handleBP5SConnected:device mac:mac];
    }
    else if ([type isEqualToString:@"HS2"]) {
        HS2 *device = [self getHS2WithMac:mac];
        if (device) [self handleHS2Connected:device mac:mac];
    }
    else if ([type isEqualToString:@"HS2S"]) {
        HS2S *device = [self getHS2SWithMac:mac];
        if (device) [self handleHS2SConnected:device mac:mac];
    }
    else if ([type isEqualToString:@"HS4S"]) {
        HS4 *device = [self getHS4WithMac:mac];
        if (device) [self handleHS4Connected:device mac:mac];
    }
    else if ([type isEqualToString:@"BG5S"]) {
        BG5S *device = [self getBG5SWithMac:mac];
        if (device) {
            [device startMeasure:BGMeasureMode_Blood withSuccessBlock:^{
                [self sendDebugLog:@"🩸 BG5S: Measurement mode re-started"];
            } errorBlock:^(BG5SError error, NSString *detailInfo) {
                [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S startMeasure error: %d", (int)error]];
            }];
        }
    }
    
    resolve(nil);
}

RCT_EXPORT_METHOD(stopMeasurement:(NSString *)mac
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"📊 stopMeasurement: %@", mac]];
    
    NSDictionary *info = _connectedDevices[mac];
    NSString *type = info[@"type"];
    
    if ([type isEqualToString:@"BP3L"]) {
        BP3L *device = [self getBP3LWithMac:mac];
        if (device) {
            [device stopBPMeassureSuccessBlock:^{
                [self sendDebugLog:@"🩺 BP3L: Measurement stopped"];
            } errorBlock:^(BPDeviceError error) {
                [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP3L stop error: %d", (int)error]];
            }];
        }
    }
    else if ([type isEqualToString:@"BP5"]) {
        BP5 *device = [self getBP5WithMac:mac];
        if (device) {
            [device stopBPMeassureSuccessBlock:^{
                [self sendDebugLog:@"🩺 BP5: Measurement stopped"];
            } errorBlock:^(BPDeviceError error) {
                [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP5 stop error: %d", (int)error]];
            }];
        }
    }
    else if ([type isEqualToString:@"BP5S"]) {
        BP5S *device = [self getBP5SWithMac:mac];
        if (device) {
            [device stopBPMeassureSuccessBlock:^{
                [self sendDebugLog:@"🩺 BP5S: Measurement stopped"];
            } errorBlock:^(BPDeviceError error) {
                [self sendDebugLog:[NSString stringWithFormat:@"🩺 BP5S stop error: %d", (int)error]];
            }];
        }
    }
    
    resolve(nil);
}

RCT_EXPORT_METHOD(getConnectedDevices:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    NSMutableArray *devices = [NSMutableArray new];
    for (NSString *mac in _connectedDevices) {
        NSDictionary *info = _connectedDevices[mac];
        [devices addObject:@{@"mac": mac, @"type": info[@"type"] ?: @"Unknown"}];
    }
    resolve(devices);
}

RCT_EXPORT_METHOD(syncOfflineData:(NSString *)mac
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"📊 syncOfflineData: %@", mac]];
    
    NSDictionary *info = _connectedDevices[mac];
    NSString *type = info[@"type"];
    
    if ([type isEqualToString:@"BG5"]) {
        BG5 *device = [self getBG5WithMac:mac];
        if (device) [self fetchBG5OfflineData:device mac:mac];
    }
    else if ([type isEqualToString:@"BG5S"]) {
        BG5S *device = [self getBG5SWithMac:mac];
        if (device) [self fetchBG5SOfflineData:device mac:mac];
    }
    else if ([type isEqualToString:@"HS2"]) {
        HS2 *device = [self getHS2WithMac:mac];
        if (device) {
            [device commandHS2TransferMemorryData:^(NSDictionary *startDataDictionary) {
                [self sendDebugLog:@"⚖️ HS2 offline transfer started"];
            } DisposeProgress:^(NSNumber *progress) {
                [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2 offline progress: %@%%", progress]];
            } MemorryData:^(NSArray *historyDataArray) {
                [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2 offline records: %lu", (unsigned long)historyDataArray.count]];
                for (NSDictionary *record in historyDataArray) {
                    NSNumber *weight = record[@"weight"] ?: @0;
                    [self sendEventSafe:@"onWeightReading" body:@{
                        @"mac": mac, @"type": @"HS2", @"weight": weight, @"unit": @"kg", @"source": @"offline"
                    }];
                }
            } FinishTransmission:^{
                [self sendDebugLog:@"⚖️ HS2 offline transfer complete"];
            } DisposeErrorBlock:^(HS2DeviceError errorID) {
                [self sendDebugLog:[NSString stringWithFormat:@"⚖️ HS2 offline error: %d", (int)errorID]];
            }];
        }
    }
    
    resolve(nil);
}

RCT_EXPORT_METHOD(getBatteryLevel:(NSString *)mac
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"🔋 getBatteryLevel: %@", mac]];
    
    NSDictionary *info = _connectedDevices[mac];
    NSString *type = info[@"type"];
    
    if ([type isEqualToString:@"BP3L"]) {
        BP3L *device = [self getBP3LWithMac:mac];
        if (device) {
            [device commandEnergy:^(NSNumber *energyValue) { resolve(energyValue); } errorBlock:^(BPDeviceError error) { resolve(@(-1)); }];
            return;
        }
    }
    else if ([type isEqualToString:@"BP5"]) {
        BP5 *device = [self getBP5WithMac:mac];
        if (device) {
            [device commandEnergy:^(NSNumber *energyValue) { resolve(energyValue); } errorBlock:^(BPDeviceError error) { resolve(@(-1)); }];
            return;
        }
    }
    else if ([type isEqualToString:@"BP5S"]) {
        BP5S *device = [self getBP5SWithMac:mac];
        if (device) {
            [device commandEnergy:^(NSNumber *energyValue) { resolve(energyValue); } errorBlock:^(BPDeviceError error) { resolve(@(-1)); }];
            return;
        }
    }
    else if ([type isEqualToString:@"HS2"]) {
        HS2 *device = [self getHS2WithMac:mac];
        if (device) {
            [device commandGetHS2Battery:^(NSNumber *battery) { resolve(battery); } DiaposeErrorBlock:^(HS2DeviceError error) { resolve(@(-1)); }];
            return;
        }
    }
    else if ([type isEqualToString:@"BG5"]) {
        BG5 *device = [self getBG5WithMac:mac];
        if (device) {
            [device commandQueryBattery:^(NSNumber *energy) { resolve(energy); } DisposeErrorBlock:^(NSNumber *errorID) { resolve(@(-1)); }];
            return;
        }
    }
    else if ([type isEqualToString:@"BG5S"]) {
        BG5S *device = [self getBG5SWithMac:mac];
        if (device) {
            [device queryStateInfoWithSuccess:^(BG5SStateInfo *stateInfo) { resolve(@(stateInfo.batteryValue)); } errorBlock:^(BG5SError error, NSString *detailInfo) { resolve(@(-1)); }];
            return;
        }
    }
    
    resolve(@(-1));
}

#pragma mark - Helpers

- (HealthDeviceType)deviceTypeFromString:(NSString *)type {
    if ([type isEqualToString:@"BP3L"]) return HealthDeviceType_BP3L;
    if ([type isEqualToString:@"BP5"]) return HealthDeviceType_BP5;
    if ([type isEqualToString:@"BP5S"]) return HealthDeviceType_BP5S;
    if ([type isEqualToString:@"HS2"]) return HealthDeviceType_HS2;
    if ([type isEqualToString:@"HS2S"]) return HealthDeviceType_HS2S;
    if ([type isEqualToString:@"HS4S"]) return HealthDeviceType_HS4;
    if ([type isEqualToString:@"BG5"]) return HealthDeviceType_BG5;
    if ([type isEqualToString:@"BG5S"]) return HealthDeviceType_BG5S;
    return HealthDeviceType_BP3L;
}

RCT_EXPORT_METHOD(sendBG5SCommand:(NSString *)hexCommand
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    if (!_connectedBG5SPeripheral || !_bg5sWriteChar) {
        reject(@"not_connected", @"BG5S not connected or no write characteristic", nil);
        return;
    }
    
    NSData *data = [self dataFromHexString:hexCommand];
    if (!data || data.length == 0) {
        reject(@"invalid_hex", @"Invalid hex string", nil);
        return;
    }
    
    [self sendBG5SCommand:data];
    resolve(@YES);
}

RCT_EXPORT_METHOD(getBG5SProtocolLog:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(_bg5sRxLog ?: @[]);
}

RCT_EXPORT_METHOD(clearBG5SProtocolLog:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [_bg5sRxLog removeAllObjects];
    resolve(@YES);
}

// Fallback method to trigger CoreBluetooth scan for BG5S if SDK scan fails
RCT_EXPORT_METHOD(startBG5SFallbackScan:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:@"📡 Starting BG5S CoreBluetooth fallback scan..."];
    _scanningForBG5S = YES;
    [self startCoreBluetoothScanForBG5S];
    resolve(@YES);
}

@end
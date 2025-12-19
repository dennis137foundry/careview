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

// BG5S service UUID (ASCII: "com.jiuan.dev")
static NSString * const kBG5SServiceUUID = @"636F6D2E-6A69-7561-6E2E-646576000000";

// BG5S uses delegate pattern
@interface IHealthDevices () <BG5SDelegate, CBCentralManagerDelegate, CBPeripheralDelegate>
@end

// BG5S BLE characteristic UUIDs (decoded from "com.jiuan.dev" pattern)
static NSString * const kBG5SNotifyCharUUID = @"7365642E-6A69-7561-6E2E-646576000000";  // "sed.jiuan.dev" - notify
static NSString * const kBG5SWriteCharUUID = @"7265632E-6A69-7561-6E2E-646576000000";   // "rec.jiuan.dev" - write

@implementation IHealthDevices {
    BOOL _isAuthenticated;
    BOOL _hasListeners;
    BOOL _controllersInitialized;
    NSMutableDictionary *_connectedDevices;
    NSString *_targetMAC;
    NSString *_targetType;
    
    // CoreBluetooth for BG5S scanning and connection
    CBCentralManager *_centralManager;
    BOOL _isScanning;
    BOOL _scanningForBG5S;
    NSMutableDictionary *_discoveredBG5SDevices;  // identifier -> {peripheral, serial}
    NSMutableDictionary *_bg5sPeripherals;        // serial -> peripheral (for connection lookup)
    CBPeripheral *_connectedBG5SPeripheral;
    NSString *_connectedBG5SSerial;
    
    // BG5S BLE characteristics for direct communication
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
        
        // Initialize CoreBluetooth manager for BG5S scanning
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

#pragma mark - CoreBluetooth Delegate (BG5S Discovery)

- (void)centralManagerDidUpdateState:(CBCentralManager *)central {
    NSString *stateStr;
    switch (central.state) {
        case CBManagerStatePoweredOn:
            stateStr = @"PoweredOn";
            break;
        case CBManagerStatePoweredOff:
            stateStr = @"PoweredOff";
            break;
        case CBManagerStateUnauthorized:
            stateStr = @"Unauthorized";
            break;
        case CBManagerStateUnsupported:
            stateStr = @"Unsupported";
            break;
        case CBManagerStateResetting:
            stateStr = @"Resetting";
            break;
        default:
            stateStr = @"Unknown";
            break;
    }
    [self sendDebugLog:[NSString stringWithFormat:@"📱📱📱 CoreBluetooth state: %@ 📱📱📱", stateStr]];
    
    // If we were waiting to scan for BG5S, start now
    if (central.state == CBManagerStatePoweredOn && _scanningForBG5S) {
        [self sendDebugLog:@"📱 BT ready, starting deferred BG5S scan..."];
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
    
    // LOG ALL PERIPHERALS for debugging
    static NSMutableSet *loggedPeripherals = nil;
    if (!loggedPeripherals) {
        loggedPeripherals = [NSMutableSet new];
    }
    
    NSString *identifier = peripheral.identifier.UUIDString;
    if (![loggedPeripherals containsObject:identifier]) {
        [loggedPeripherals addObject:identifier];
        
        // Log every unique peripheral we find
        [self sendDebugLog:[NSString stringWithFormat:@"🔍 BLE PERIPHERAL: name='%@' localName='%@' RSSI=%@", 
                           peripheralName, localName, RSSI]];
        
        // Log service UUIDs if available
        NSArray *serviceUUIDs = advertisementData[CBAdvertisementDataServiceUUIDsKey];
        if (serviceUUIDs.count > 0) {
            [self sendDebugLog:[NSString stringWithFormat:@"   Services: %@", serviceUUIDs]];
        }
        
        // Log manufacturer data
        NSData *mfgData = advertisementData[CBAdvertisementDataManufacturerDataKey];
        if (mfgData) {
            [self sendDebugLog:[NSString stringWithFormat:@"   MfgData: %@", mfgData]];
        }
    }
    
    // Check if this is a BG5S device - use LocalName which has the actual device name
    BOOL isBG5S = [localName containsString:@"BG5S"] || 
                  [localName containsString:@"bg5s"] ||
                  [peripheralName containsString:@"BG5S"] ||
                  [peripheralName containsString:@"bg5s"];
    
    if (isBG5S) {
        // Extract MAC/serial from manufacturer data or name
        NSString *identifier = peripheral.identifier.UUIDString;
        NSString *serialNumber = @"";
        
        // Try to extract from manufacturer data
        NSData *manufacturerData = advertisementData[CBAdvertisementDataManufacturerDataKey];
        if (manufacturerData && manufacturerData.length >= 8) {
            // iHealth manufacturer data format: Company ID (2 bytes) + MAC (6 bytes)
            const unsigned char *bytes = manufacturerData.bytes;
            serialNumber = [NSString stringWithFormat:@"%02X%02X%02X%02X%02X%02X",
                           bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7]];
            [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S serial from mfgData: %@", serialNumber]];
        }
        
        // Fallback: extract from LocalName (e.g., "BG5S 11070" -> "11070")
        if (serialNumber.length == 0 || [serialNumber isEqualToString:@"000000000000"]) {
            NSArray *parts = [localName componentsSeparatedByString:@" "];
            if (parts.count > 1) {
                serialNumber = [NSString stringWithFormat:@"BG5S%@", parts[1]];
            } else {
                serialNumber = [NSString stringWithFormat:@"BG5S_%@", [[identifier substringToIndex:8] uppercaseString]];
            }
            [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S serial from name: %@", serialNumber]];
        }
        
        // Avoid duplicate notifications
        if (_discoveredBG5SDevices[identifier]) {
            return;
        }
        _discoveredBG5SDevices[identifier] = @{
            @"peripheral": peripheral,
            @"serial": serialNumber,
            @"name": displayName
        };
        
        // Also store by serial for connection lookup
        _bg5sPeripherals[serialNumber] = peripheral;
        
        [self sendDebugLog:[NSString stringWithFormat:@"📡 BG5S DISCOVERED via CoreBluetooth: %@ (RSSI: %@)", displayName, RSSI]];
        [self sendDebugLog:[NSString stringWithFormat:@"   Identifier: %@", identifier]];
        [self sendDebugLog:[NSString stringWithFormat:@"   Serial: %@", serialNumber]];
        [self sendDebugLog:[NSString stringWithFormat:@"   Advertisement: %@", advertisementData]];
        
        // Send to JS - same format as iHealth SDK discovery
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventSafe:@"onDeviceFound" body:@{
                @"mac": serialNumber,
                @"name": displayName,
                @"type": @"BG5S",
                @"rssi": RSSI,
                @"source": @"CoreBluetooth"
            }];
        });
        
        // If this is our target device, connect via CoreBluetooth (SDK scan doesn't work for BG5S)
        if (self->_targetMAC && [[serialNumber uppercaseString] containsString:[self->_targetMAC uppercaseString]]) {
            [self sendDebugLog:@"🎯 TARGET BG5S FOUND - initiating CoreBluetooth connection..."];
            [self connectBG5SPeripheral:peripheral serial:serialNumber];
        }
    }
}

- (void)startCoreBluetoothScanForBG5S {
    [self sendDebugLog:[NSString stringWithFormat:@"📡 CoreBluetooth scan requested. Manager state: %ld", (long)_centralManager.state]];
    
    if (_centralManager.state != CBManagerStatePoweredOn) {
        [self sendDebugLog:@"📱 CoreBluetooth not ready (state != PoweredOn), will scan when powered on"];
        _scanningForBG5S = YES;
        return;
    }
    
    [self sendDebugLog:@"📡📡📡 STARTING CoreBluetooth scan for ALL peripherals 📡📡📡"];
    
    // Clear previous discoveries
    [_discoveredBG5SDevices removeAllObjects];
    
    // Scan for ALL devices - no service filter, no duplicates filter
    // This should find everything that's advertising
    [_centralManager scanForPeripheralsWithServices:nil
                                            options:@{
        CBCentralManagerScanOptionAllowDuplicatesKey: @YES  // Allow duplicates to see everything
    }];
    
    _isScanning = YES;
    [self sendDebugLog:@"📡 CoreBluetooth scanForPeripheralsWithServices called - listening for discoveries..."];
    
    // Auto-stop after 20 seconds (longer timeout)
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(20 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (self->_isScanning && self->_scanningForBG5S) {
            [self sendDebugLog:@"📡 CoreBluetooth BG5S scan timeout - stopping"];
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

#pragma mark - CoreBluetooth Connection for BG5S

- (void)connectBG5SPeripheral:(CBPeripheral *)peripheral serial:(NSString *)serial {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 BG5S: Connecting via CoreBluetooth to %@...", serial]];
    
    _connectedBG5SSerial = serial;
    peripheral.delegate = self;
    [_centralManager connectPeripheral:peripheral options:nil];
}

- (CBPeripheral *)findBG5SPeripheralBySerial:(NSString *)serial {
    // First check direct lookup
    CBPeripheral *peripheral = _bg5sPeripherals[serial];
    if (peripheral) {
        return peripheral;
    }
    
    // Search through discovered devices
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
    
    // Stop scanning once connected
    [self stopCoreBluetoothScan];
    
    // Discover services
    [self sendDebugLog:@"🔍 Discovering BG5S services..."];
    [peripheral discoverServices:nil];
    
    // Also try to let the SDK know about this connection
    dispatch_async(dispatch_get_main_queue(), ^{
        NSString *serial = self->_connectedBG5SSerial ?: @"";
        
        // Store in connected devices
        self->_connectedDevices[serial] = @{@"type": @"BG5S", @"mac": serial};
        
        // Notify JS layer
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
        
        // Check if this is the BG5S notify characteristic
        NSString *notifyUUID = [kBG5SNotifyCharUUID uppercaseString];
        NSString *writeUUID = [kBG5SWriteCharUUID uppercaseString];
        
        if ([uuidStr isEqualToString:notifyUUID]) {
            _bg5sNotifyChar = characteristic;
            [self sendDebugLog:@"   ✅ Found BG5S NOTIFY characteristic"];
            [peripheral setNotifyValue:YES forCharacteristic:characteristic];
        }
        // Check if this is the BG5S write characteristic  
        else if ([uuidStr isEqualToString:writeUUID]) {
            _bg5sWriteChar = characteristic;
            [self sendDebugLog:@"   ✅ Found BG5S WRITE characteristic"];
        }
        // Also check by properties - props:4 = WriteWithoutResponse
        else if ((characteristic.properties & CBCharacteristicPropertyWrite) || 
                 (characteristic.properties & CBCharacteristicPropertyWriteWithoutResponse)) {
            if (!_bg5sWriteChar) {
                _bg5sWriteChar = characteristic;
                [self sendDebugLog:@"   ✅ Found WRITABLE characteristic (fallback)"];
            }
        }
        
        // Subscribe to ALL notifiable/indicatable characteristics
        if (characteristic.properties & (CBCharacteristicPropertyNotify | CBCharacteristicPropertyIndicate)) {
            [self sendDebugLog:[NSString stringWithFormat:@"   📡 Subscribing to %@", characteristic.UUID]];
            [peripheral setNotifyValue:YES forCharacteristic:characteristic];
        }
        
        // Read ALL readable characteristics (may trigger handshake)
        if (characteristic.properties & CBCharacteristicPropertyRead) {
            [self sendDebugLog:[NSString stringWithFormat:@"   📖 Reading %@", characteristic.UUID]];
            [peripheral readValueForCharacteristic:characteristic];
        }
    }
    
    // Log final state
    [self sendDebugLog:[NSString stringWithFormat:@"   📋 Summary: NotifyChar=%@, WriteChar=%@",
                       _bg5sNotifyChar ? @"YES" : @"NO",
                       _bg5sWriteChar ? @"YES" : @"NO"]];
}
- (void)peripheral:(CBPeripheral *)peripheral didUpdateValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ Char read/update error: %@", error.localizedDescription]];
        return;
    }
    
    NSData *data = characteristic.value;
    NSString *charUUID = characteristic.UUID.UUIDString;
    
    // Log ALL characteristic updates, not just main one
    if (data && data.length > 0) {
        // Convert to hex string
        NSMutableString *hexString = [NSMutableString stringWithCapacity:data.length * 3];
        const uint8_t *bytes = data.bytes;
        for (int i = 0; i < data.length; i++) {
            [hexString appendFormat:@"%02X ", bytes[i]];
        }
        
        // Try to convert to string if it's readable text
        NSString *textValue = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
        
        [self sendDebugLog:@"───────────────────────────────────────────"];
        [self sendDebugLog:[NSString stringWithFormat:@"📨 RX from %@:", charUUID]];
        [self sendDebugLog:[NSString stringWithFormat:@"   HEX:   %@", hexString]];
        if (textValue && textValue.length > 0 && textValue.length < 50) {
            [self sendDebugLog:[NSString stringWithFormat:@"   ASCII: %@", textValue]];
        }
        [self sendDebugLog:[NSString stringWithFormat:@"   LEN:   %lu bytes", (unsigned long)data.length]];
        
        // Store in protocol log for analysis
        NSDictionary *logEntry = @{
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000),
            @"characteristic": charUUID,
            @"hex": hexString,
            @"length": @(data.length)
        };
        [_bg5sRxLog addObject:logEntry];
        
        // Send to JS for real-time viewing
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventSafe:@"onBG5SProtocolData" body:@{
                @"direction": @"RX",
                @"characteristic": charUUID,
                @"hex": hexString,
                @"length": @(data.length),
                @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
            }];
        });
        
        // Parse if it's from our main notify characteristic
        if ([charUUID.uppercaseString containsString:@"7365"]) {
            [self parseBG5SData:data];
        }
        
        // Log known Device Info characteristics
        if ([charUUID isEqualToString:@"2A24"]) {
            [self sendDebugLog:[NSString stringWithFormat:@"   → Model Number: %@", textValue]];
        } else if ([charUUID isEqualToString:@"2A25"]) {
            [self sendDebugLog:[NSString stringWithFormat:@"   → Serial Number: %@", textValue]];
        } else if ([charUUID isEqualToString:@"2A29"]) {
            [self sendDebugLog:[NSString stringWithFormat:@"   → Manufacturer: %@", textValue]];
        } else if ([charUUID.uppercaseString isEqualToString:@"FF01"]) {
            [self sendDebugLog:[NSString stringWithFormat:@"   → Protocol ID: %@", textValue]];
        } else if ([charUUID.uppercaseString isEqualToString:@"FF02"]) {
            [self sendDebugLog:[NSString stringWithFormat:@"   → Device Type: %@", textValue]];
        }
    } else {
        [self sendDebugLog:[NSString stringWithFormat:@"📨 Empty data from %@", charUUID]];
    }
}


#pragma mark - BG5S BLE Protocol Parsing

- (void)parseBG5SData:(NSData *)data {
    if (data.length < 2) {
        return;
    }
    
    const uint8_t *bytes = data.bytes;
    uint8_t commandType = bytes[0];
    
    [self sendDebugLog:[NSString stringWithFormat:@"🔬 BG5S parsing - command type: 0x%02X, length: %lu", 
                       commandType, (unsigned long)data.length]];
    
    // Log all bytes for analysis
    NSMutableString *hexString = [NSMutableString stringWithCapacity:data.length * 3];
    for (int i = 0; i < data.length; i++) {
        [hexString appendFormat:@"%02X ", bytes[i]];
    }
    [self sendDebugLog:[NSString stringWithFormat:@"   Bytes: %@", hexString]];
    
    // Common BG5S protocol patterns (based on reverse engineering):
    // These are approximate - actual protocol may differ
    
    // Strip state notifications
    if (commandType == 0x31 || commandType == 0x32) {
        // Strip inserted/removed
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
    // Glucose result - typically starts with specific command byte
    else if (commandType == 0x35 || commandType == 0x36 || commandType == 0x40) {
        // Result packet - extract glucose value
        // Format varies by device, but typically:
        // [cmd] [high byte] [low byte] or similar
        
        int glucoseValue = 0;
        if (data.length >= 3) {
            // Try common formats
            glucoseValue = (bytes[1] << 8) | bytes[2];  // Big endian
            if (glucoseValue > 600 || glucoseValue < 10) {
                // Try little endian
                glucoseValue = (bytes[2] << 8) | bytes[1];
            }
            if (glucoseValue > 600 || glucoseValue < 10) {
                // Try just byte 1 or 2
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
        // Unknown command - log for analysis
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
    
    [self sendDebugLog:[NSString stringWithFormat:@"📤 Sending BG5S command: %@", command]];
    
    CBCharacteristicWriteType writeType = (_bg5sWriteChar.properties & CBCharacteristicPropertyWriteWithoutResponse) 
        ? CBCharacteristicWriteWithoutResponse 
        : CBCharacteristicWriteWithResponse;
    
    [_connectedBG5SPeripheral writeValue:command forCharacteristic:_bg5sWriteChar type:writeType];
}

- (void)peripheral:(CBPeripheral *)peripheral didUpdateNotificationStateForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ BG5S notification error: %@", error.localizedDescription]];
        return;
    }
    
    NSString *charUUID = [characteristic.UUID.UUIDString uppercaseString];
    [self sendDebugLog:[NSString stringWithFormat:@"📡 Notification %@ for %@", 
                       characteristic.isNotifying ? @"ON" : @"OFF", characteristic.UUID]];
    
    // Check if this is our main notify characteristic (7365... = sed.jiuan.dev)
    if (characteristic.isNotifying && [charUUID containsString:@"7365"]) {
        _bg5sNotificationsEnabled = YES;
        _bg5sMeasurementActive = YES;
        [self sendDebugLog:@"✅ BG5S READY - Insert test strip now"];
        [self sendDebugLog:@"👀 Watching for ANY data from device..."];
        
        // AUTO-SEND INIT to keep connection alive!
        [self sendDebugLog:@"🚀 AUTO-SENDING init sequence in 500ms..."];
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
            [self sendBG5SInitSequence];
        });
        
        dispatch_async(dispatch_get_main_queue(), ^{
            [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
                @"mac": self->_connectedBG5SSerial ?: @"",
                @"type": @"BG5S",
                @"status": @"ready"
            }];
        });
    }
}

- (void)sendBG5SInitSequence {
    [self sendDebugLog:@"═══════════════════════════════════════════"];
    [self sendDebugLog:@"🚀 sendBG5SInitSequence CALLED"];
    [self sendDebugLog:[NSString stringWithFormat:@"   peripheral: %@", _connectedBG5SPeripheral ? @"YES" : @"NO"]];
    [self sendDebugLog:[NSString stringWithFormat:@"   writeChar: %@", _bg5sWriteChar ? @"YES" : @"NO"]];
    
    if (!_connectedBG5SPeripheral) {
        [self sendDebugLog:@"❌ ABORT: No peripheral"];
        return;
    }
    if (!_bg5sWriteChar) {
        [self sendDebugLog:@"❌ ABORT: No write characteristic"];
        return;
    }
    
    [self sendDebugLog:@"✅ All checks passed - sending commands..."];
    
    // Command 1: Identify/Handshake
    uint8_t cmd1[] = {0xA0, 0x00, 0xFA, 0x00, 0xFA};
    [self writeBG5SBytes:cmd1 length:5 label:@"CMD1: IDENTIFY"];
    
    // Command 2: Get Status (after delay)
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(0.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (!self->_connectedBG5SPeripheral || !self->_bg5sWriteChar) {
            [self sendDebugLog:@"❌ CMD2 aborted - disconnected"];
            return;
        }
        uint8_t cmd2[] = {0xA0, 0x00, 0x26, 0x00, 0x26};
        [self writeBG5SBytes:cmd2 length:5 label:@"CMD2: GET_STATUS"];
    });
    
    // Command 3: Start Measure
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        if (!self->_connectedBG5SPeripheral || !self->_bg5sWriteChar) {
            [self sendDebugLog:@"❌ CMD3 aborted - disconnected"];
            return;
        }
        uint8_t cmd3[] = {0xA0, 0x00, 0x31, 0x01, 0x01, 0x33};
        [self writeBG5SBytes:cmd3 length:6 label:@"CMD3: START_MEASURE"];
    });
    
    // Schedule keep-alive
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(1.5 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self startBG5SKeepAlive];
    });
}

- (void)startBG5SKeepAlive {
    if (!_connectedBG5SPeripheral || !_bg5sWriteChar || !_bg5sMeasurementActive) {
        [self sendDebugLog:@"💔 Keep-alive stopped - not connected"];
        return;
    }
    
    [self sendDebugLog:@"💓 Sending keep-alive ping..."];
    uint8_t ping[] = {0xA0, 0x00, 0x26, 0x00, 0x26};
    [self writeBG5SBytes:ping length:5 label:@"KEEP_ALIVE"];
    
    // Schedule next keep-alive in 8 seconds
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(8.0 * NSEC_PER_SEC)), dispatch_get_main_queue(), ^{
        [self startBG5SKeepAlive];
    });
}

// Keep these methods but they won't be called - available for future use
- (void)attemptBG5SMeasurementStart {
    // DISABLED - causes crashes
    [self sendDebugLog:@"⚠️ attemptBG5SMeasurementStart disabled"];
}

- (void)trySDKStartMeasure:(NSString *)mac {
    // DISABLED - causes crashes  
    [self sendDebugLog:@"⚠️ trySDKStartMeasure disabled"];
}

- (void)sendBG5SInitCommands {
    // DISABLED - causes crashes
    [self sendDebugLog:@"⚠️ sendBG5SInitCommands disabled"];
}

RCT_EXPORT_METHOD(sendBG5SInit:(RCTPromiseResolveBlock)resolve rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:@"═══════════════════════════════════════════"];
    [self sendDebugLog:@"🔘 sendBG5SInit BUTTON PRESSED"];
    [self sendDebugLog:[NSString stringWithFormat:@"   peripheral: %@", _connectedBG5SPeripheral ? _connectedBG5SPeripheral.name : @"nil"]];
    [self sendDebugLog:[NSString stringWithFormat:@"   writeChar: %@", _bg5sWriteChar ? _bg5sWriteChar.UUID.UUIDString : @"nil"]];
    [self sendDebugLog:[NSString stringWithFormat:@"   notifyChar: %@", _bg5sNotifyChar ? _bg5sNotifyChar.UUID.UUIDString : @"nil"]];
    [self sendDebugLog:[NSString stringWithFormat:@"   serial: %@", _connectedBG5SSerial ?: @"nil"]];
    
    if (!_connectedBG5SPeripheral) {
        [self sendDebugLog:@"❌ REJECTED: No peripheral connected"];
        reject(@"not_connected", @"BG5S peripheral not connected", nil);
        return;
    }
    if (!_bg5sWriteChar) {
        [self sendDebugLog:@"❌ REJECTED: No write characteristic"];
        reject(@"no_write_char", @"BG5S write characteristic not found", nil);
        return;
    }
    
    [self sendDebugLog:@"✅ Calling sendBG5SInitSequence..."];
    [self sendBG5SInitSequence];
    
    resolve(@"Init sequence started");
}

- (void)writeBG5SBytes:(uint8_t *)bytes length:(NSUInteger)length label:(NSString *)label {
    [self sendDebugLog:[NSString stringWithFormat:@"📤 writeBG5SBytes: %@", label]];
    
    if (!_connectedBG5SPeripheral) {
        [self sendDebugLog:@"   ❌ FAILED: No peripheral"];
        return;
    }
    if (!_bg5sWriteChar) {
        [self sendDebugLog:@"   ❌ FAILED: No write characteristic"];
        return;
    }
    
    NSData *data = [NSData dataWithBytes:bytes length:length];
    NSString *hex = [self hexStringFromData:data];
    [self sendDebugLog:[NSString stringWithFormat:@"   📤 TX: %@", hex]];
    
    CBCharacteristicWriteType writeType = CBCharacteristicWriteWithoutResponse;
    if (_bg5sWriteChar.properties & CBCharacteristicPropertyWrite) {
        writeType = CBCharacteristicWriteWithResponse;
        [self sendDebugLog:@"   Using WriteWithResponse"];
    } else {
        [self sendDebugLog:@"   Using WriteWithoutResponse"];
    }
    
    @try {
        [_connectedBG5SPeripheral writeValue:data forCharacteristic:_bg5sWriteChar type:writeType];
        [self sendDebugLog:@"   ✅ Write dispatched"];
    } @catch (NSException *exception) {
        [self sendDebugLog:[NSString stringWithFormat:@"   ❌ Write EXCEPTION: %@", exception.reason]];
    }
}

- (void)sendBG5SCommandBytes:(uint8_t *)bytes length:(NSUInteger)length {
    if (!_connectedBG5SPeripheral || !_bg5sWriteChar) return;
    
    NSData *data = [NSData dataWithBytes:bytes length:length];
    
    CBCharacteristicWriteType writeType = (_bg5sWriteChar.properties & CBCharacteristicPropertyWriteWithoutResponse) 
        ? CBCharacteristicWriteWithoutResponse 
        : CBCharacteristicWriteWithResponse;
    
    [_connectedBG5SPeripheral writeValue:data forCharacteristic:_bg5sWriteChar type:writeType];
}

- (void)peripheral:(CBPeripheral *)peripheral didWriteValueForCharacteristic:(CBCharacteristic *)characteristic error:(NSError *)error {
    if (error) {
        [self sendDebugLog:[NSString stringWithFormat:@"❌ BG5S write error: %@", error.localizedDescription]];
    } else {
        [self sendDebugLog:[NSString stringWithFormat:@"✅ BG5S write success for %@", characteristic.UUID]];
    }
}

- (void)centralManager:(CBCentralManager *)central didDisconnectPeripheral:(CBPeripheral *)peripheral error:(NSError *)error {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 CoreBluetooth DISCONNECTED: %@ (error: %@)", 
                       peripheral.name, error.localizedDescription ?: @"none"]];
    
    NSString *serial = _connectedBG5SSerial ?: @"";
    [_connectedDevices removeObjectForKey:serial];
    
    // Clear all BG5S state
    _connectedBG5SPeripheral = nil;
    _connectedBG5SSerial = nil;
    _bg5sNotifyChar = nil;
    _bg5sWriteChar = nil;
    _bg5sMeasurementActive = NO;  // This stops keep-alive
    _bg5sNotificationsEnabled = NO;
    
    dispatch_async(dispatch_get_main_queue(), ^{
        [self sendEventSafe:@"onConnectionStateChanged" body:@{
            @"mac": serial,
            @"type": @"BG5S",
            @"connected": @NO
        }];
    });
}

#pragma mark - Controller Initialization (CRITICAL - Must happen AFTER authentication!)

- (void)initializeControllers {
    if (_controllersInitialized) {
        [self sendDebugLog:@"🎮 Controllers already initialized"];
        return;
    }
    
    [self sendDebugLog:@"🎮 Initializing device controllers..."];
    
    // Blood Pressure Controllers
    [BP3LController shareBP3LController];
    [self sendDebugLog:@"🎮 BP3LController initialized"];
    
    [BP5Controller shareBP5Controller];
    [self sendDebugLog:@"🎮 BP5Controller initialized"];
    
    // NOTE: BP5S uses sharedController (not shareBP5SController!)
    [BP5SController sharedController];
    [self sendDebugLog:@"🎮 BP5SController initialized"];
    
    // Scale Controllers
    [HS2Controller shareIHHs2Controller];
    [self sendDebugLog:@"🎮 HS2Controller initialized"];
    
    [HS2SController shareIHHS2SController];
    [self sendDebugLog:@"🎮 HS2SController initialized"];
    
    [HS4Controller shareIHHs4Controller];
    [self sendDebugLog:@"🎮 HS4Controller (HS4S) initialized"];
    
    // Blood Glucose Controllers
    [BG5Controller shareIHBg5Controller];
    [self sendDebugLog:@"🎮 BG5Controller initialized"];
    
    // NOTE: BG5S uses sharedController (not shareIHBg5SController!)
    [BG5SController sharedController];
    [self sendDebugLog:@"🎮 BG5SController initialized"];
    
    _controllersInitialized = YES;
    [self sendDebugLog:@"🎮 All controllers initialized!"];
}

#pragma mark - Device Retrieval (CRITICAL - Get from controller, not notification!)

- (BP3L *)getBP3LWithMac:(NSString *)mac {
    BP3LController *controller = [BP3LController shareBP3LController];
    NSArray *devices = [controller getAllCurrentBP3LInstace];
    for (BP3L *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) {
            return device;
        }
    }
    return nil;
}

- (BP5 *)getBP5WithMac:(NSString *)mac {
    BP5Controller *controller = [BP5Controller shareBP5Controller];
    NSArray *devices = [controller getAllCurrentBP5Instace];
    for (BP5 *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) {
            return device;
        }
    }
    return nil;
}

- (BP5S *)getBP5SWithMac:(NSString *)mac {
    BP5SController *controller = [BP5SController sharedController];
    NSArray *devices = [controller getAllCurrentInstance];
    for (BP5S *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) {
            return device;
        }
    }
    return nil;
}

- (HS2 *)getHS2WithMac:(NSString *)mac {
    HS2Controller *controller = [HS2Controller shareIHHs2Controller];
    NSArray *devices = [controller getAllCurrentHS2Instace];
    for (HS2 *device in devices) {
        // HS2 uses deviceID, not serialNumber!
        if ([mac isEqualToString:device.deviceID]) {
            return device;
        }
    }
    return nil;
}

- (HS2S *)getHS2SWithMac:(NSString *)mac {
    HS2SController *controller = [HS2SController shareIHHS2SController];
    NSArray *devices = [controller getAllCurrentHS2SInstace];
    for (HS2S *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) {
            return device;
        }
    }
    return nil;
}

- (HS4 *)getHS4WithMac:(NSString *)mac {
    HS4Controller *controller = [HS4Controller shareIHHs4Controller];
    NSArray *devices = [controller getAllCurrentHS4Instace];
    for (HS4 *device in devices) {
        // HS4/HS4S uses deviceID, not serialNumber!
        if ([mac isEqualToString:device.deviceID]) {
            return device;
        }
    }
    return nil;
}

- (BG5 *)getBG5WithMac:(NSString *)mac {
    BG5Controller *controller = [BG5Controller shareIHBg5Controller];
    NSArray *devices = [controller getAllCurrentBG5Instace];
    for (BG5 *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) {
            return device;
        }
    }
    return nil;
}

- (BG5S *)getBG5SWithMac:(NSString *)mac {
    BG5SController *controller = [BG5SController sharedController];
    NSArray *devices = [controller getAllCurrentInstace];
    for (BG5S *device in devices) {
        if ([mac isEqualToString:device.serialNumber]) {
            // BG5S uses delegate pattern - set ourselves as delegate
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
    
    // BG5S - keep these for when SDK eventually does work or for connection notifications
    [center addObserver:self selector:@selector(onDiscover:) name:@"BG5SDiscover" object:nil];
    [center addObserver:self selector:@selector(onConnected:) name:@"BG5SConnectNoti" object:nil];
    [center addObserver:self selector:@selector(onDisconnected:) name:@"BG5SDisConnectNoti" object:nil];

    [self sendDebugLog:@"📡 Notification observers registered for all devices"];
}

- (NSString *)typeFromName:(NSString *)name {
    // Order matters - check more specific first
    if ([name containsString:@"BP3L"]) return @"BP3L";
    if ([name containsString:@"BP5S"]) return @"BP5S";
    if ([name containsString:@"BP5"]) return @"BP5";
    if ([name containsString:@"HS2S"]) return @"HS2S";
    if ([name containsString:@"HS2"]) return @"HS2";
    if ([name containsString:@"HS4"]) return @"HS4S"; // HS4 is marketed as HS4S
    if ([name containsString:@"BG5S"]) return @"BG5S";
    if ([name containsString:@"BG5"]) return @"BG5";
    return @"Unknown";
}

- (NSString *)getMacFromNotification:(NSNotification *)notification forType:(NSString *)type {
    NSDictionary *info = notification.userInfo;
    
    // Different devices use different keys for their identifier
    // HS2 and HS4 use DeviceID/ID, others use SerialNumber
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

    [self sendDebugLog:[NSString stringWithFormat:@"📡 DISCOVERED: %@ (%@)", mac, type]];
    [self sendDebugLog:[NSString stringWithFormat:@"   Notification: %@", notification.name]];
    [self sendDebugLog:[NSString stringWithFormat:@"   UserInfo: %@", info]];

    [self sendEventSafe:@"onDeviceFound" body:@{
        @"mac": mac,
        @"name": info[@"DeviceName"] ?: type,
        @"type": type,
        @"rssi": info[@"RSSI"] ?: @(-50),
        @"source": @"iHealthSDK"
    }];

    // Auto-connect if this is our target (set before scan started)
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

    [self sendDebugLog:[NSString stringWithFormat:@"🔗 CONNECTED: %@ (%@)", mac, type]];
    [self sendDebugLog:[NSString stringWithFormat:@"   UserInfo keys: %@", info.allKeys]];

    // Store connection info
    _connectedDevices[mac] = @{@"type": type, @"mac": mac};
    _targetMAC = nil;
    _targetType = nil;

    [self sendEventSafe:@"onConnectionStateChanged" body:@{
        @"mac": mac,
        @"type": type,
        @"connected": @YES
    }];

    // Get device from controller and start measurement
    // This is the CORRECT pattern - get from controller, not from notification!
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
                [self handleBG5SConnected:device mac:mac];
            } else {
                [self sendDebugLog:@"❌ BG5S: Could not get device from controller"];
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
        // Silent
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
        // Silent
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
        // Silent
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
    
    // Store device reference
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
        [self sendDebugLog:@"🩸 BG5: Call setBottleCode with QR data before measurement"];
        [self fetchBG5OfflineData:bg mac:mac];
        
    } DisposeBGErrorBlock:^(NSNumber *errorID) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 time set error: %@", errorID]];
    }];
}

// Set bottle code for BG5 from QR scan
// QR code contains: BottleID, StripNum, DueDate
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
    
    // Parse the QR code to get bottle info
    NSDictionary *bottleInfo = [device codeStripStrAnalysis:bottleCode];
    if (!bottleInfo) {
        [self sendDebugLog:@"🩸 BG5: Could not parse QR code - may be GDH type or invalid"];
        // For GDH strips, we still need to send the code
    } else {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5: Parsed bottle info: %@", bottleInfo]];
    }
    
    // Extract info from QR or use defaults
    NSNumber *stripNum = bottleInfo[@"StripNum"] ?: @25;
    NSDate *dueDate = bottleInfo[@"DueDate"] ?: [[NSDate date] dateByAddingTimeInterval:365*24*60*60]; // 1 year default
    
    // Send code to device - using Blood mode and GOD code type
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

// Setup measurement for strip-boot mode
- (void)setupBG5StripMeasurement:(BG5 *)device mac:(NSString *)mac {
    [device commandCreateBGtestStripInBlock:^{
        [self sendDebugLog:@"🩸 BG5: Strip inserted - waiting for blood"];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
            @"mac": mac,
            @"type": @"BG5",
            @"status": @"stripIn"
        }];
    }
                        DisposeBGBloodBlock:^{
        [self sendDebugLog:@"🩸 BG5: Blood detected - measuring..."];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
            @"mac": mac,
            @"type": @"BG5",
            @"status": @"bloodDetected"
        }];
    }
                       DisposeBGResultBlock:^(NSDictionary *result) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BG5 RESULT: %@", result]];
        
        NSNumber *value = result[@"Result"] ?: @0;
        NSString *dataID = result[@"DataID"] ?: [[NSUUID UUID] UUIDString];
        
        [self sendEventSafe:@"onBloodGlucoseReading" body:@{
            @"mac": mac,
            @"type": @"BG5",
            @"value": value,
            @"unit": @"mg/dL",
            @"dataID": dataID,
            @"source": @"live",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    }
                        DisposeBGErrorBlock:^(NSNumber *errorID) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 measurement error: %@", errorID]];
        [self sendEventSafe:@"onError" body:@{
            @"mac": mac,
            @"type": @"BG5",
            @"error": errorID,
            @"message": [self bg5ErrorMessage:[errorID intValue]]
        }];
    }];
}

// Setup measurement for button-boot mode
- (void)setupBG5HandMeasurement:(BG5 *)device mac:(NSString *)mac {
    [device commandCreateBGtestModel:BGMeasureMode_Blood
               DisposeBGStripInBlock:^{
        [self sendDebugLog:@"🩸 BG5: Strip inserted - waiting for blood"];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
            @"mac": mac,
            @"type": @"BG5",
            @"status": @"stripIn"
        }];
    }
                 DisposeBGBloodBlock:^{
        [self sendDebugLog:@"🩸 BG5: Blood detected - measuring..."];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
            @"mac": mac,
            @"type": @"BG5",
            @"status": @"bloodDetected"
        }];
    }
                DisposeBGResultBlock:^(NSDictionary *result) {
        [self sendDebugLog:[NSString stringWithFormat:@"🎉 BG5 RESULT: %@", result]];
        
        NSNumber *value = result[@"Result"] ?: @0;
        NSString *dataID = result[@"DataID"] ?: [[NSUUID UUID] UUIDString];
        
        [self sendEventSafe:@"onBloodGlucoseReading" body:@{
            @"mac": mac,
            @"type": @"BG5",
            @"value": value,
            @"unit": @"mg/dL",
            @"dataID": dataID,
            @"source": @"live",
            @"timestamp": @([[NSDate date] timeIntervalSince1970] * 1000)
        }];
    }
                 DisposeBGErrorBlock:^(NSNumber *errorID) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 measurement error: %@", errorID]];
        [self sendEventSafe:@"onError" body:@{
            @"mac": mac,
            @"type": @"BG5",
            @"error": errorID,
            @"message": [self bg5ErrorMessage:[errorID intValue]]
        }];
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
                @"mac": mac,
                @"type": @"BG5",
                @"value": value,
                @"unit": @"mg/dL",
                @"dataID": dataID,
                @"source": @"offline",
                @"timestamp": date ? @([date timeIntervalSince1970] * 1000) : @([[NSDate date] timeIntervalSince1970] * 1000)
            }];
        }
    } DisposeBGErrorBlock:^(NSNumber *errorID) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5 offline error: %@", errorID]];
    }];
}

#pragma mark - BG5S Handling

- (void)handleBG5SConnected:(BG5S *)bg mac:(NSString *)mac {
    [self sendDebugLog:@"🩸 BG5S: Connected - setting up delegate and querying status..."];
    
    // CRITICAL: Set delegate so we receive measurement callbacks
    bg.delegate = self;
    
    [bg queryStateInfoWithSuccess:^(BG5SStateInfo *stateInfo) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S status - battery: %d%%, strips used: %d, offline: %d",
                           (int)stateInfo.batteryValue,
                           (int)stateInfo.stripUsedValue,
                           (int)stateInfo.offlineDataQuantity]];
        
        // Sync time
        [bg setTimeWithDate:[NSDate date] timezone:[[NSTimeZone localTimeZone] secondsFromGMT] / 3600.0 successBlock:^{
            [self sendDebugLog:@"🩸 BG5S time synced"];
        } errorBlock:^(BG5SError error, NSString *detailInfo) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S time sync error: %d", (int)error]];
        }];
        
        // Fetch offline data if any
        if (stateInfo.offlineDataQuantity > 0) {
            [self fetchBG5SOfflineData:bg mac:mac];
        }
        
        // CRITICAL: Start measurement mode so device sends strip/blood/result events
        [self sendDebugLog:@"🩸 BG5S: Starting measurement mode..."];
        [bg startMeasure:BGMeasureMode_Blood withSuccessBlock:^{
            [self sendDebugLog:@"🩸 BG5S: Measurement mode started - INSERT TEST STRIP to begin"];
        } errorBlock:^(BG5SError error, NSString *detailInfo) {
            [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S startMeasure error: %d - %@", (int)error, detailInfo]];
        }];
        
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S status error: %d - %@", (int)error, detailInfo]];
        
        // Still try to start measurement even if status query failed
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
                @"mac": mac,
                @"type": @"BG5S",
                @"value": @(record.value),
                @"unit": @"mg/dL",
                @"dataID": record.dataID ?: @"",
                @"source": @"offline",
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
        @"mac": mac ?: @"",
        @"type": @"BG5S",
        @"error": @(error),
        @"message": errorDescription ?: @"Unknown error"
    }];
}

- (void)device:(BG5S *)device stripStateDidUpdate:(BG5SStripState)state {
    NSString *mac = device.serialNumber;
    if (state == BG5SStripState_Insert) {
        [self sendDebugLog:@"🩸 BG5S: Strip INSERTED - apply blood sample"];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
            @"mac": mac ?: @"",
            @"type": @"BG5S",
            @"status": @"stripIn"
        }];
    } else {
        [self sendDebugLog:@"🩸 BG5S: Strip REMOVED"];
        [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
            @"mac": mac ?: @"",
            @"type": @"BG5S",
            @"status": @"stripOut"
        }];
    }
}

- (void)deviceDropBlood:(BG5S *)device {
    NSString *mac = device.serialNumber;
    [self sendDebugLog:@"🩸 BG5S: Blood detected - measuring..."];
    [self sendEventSafe:@"onBloodGlucoseStatus" body:@{
        @"mac": mac ?: @"",
        @"type": @"BG5S",
        @"status": @"bloodDetected"
    }];
}

- (void)device:(BG5S *)device dataID:(NSString *)dataID measureReult:(NSInteger)result {
    NSString *mac = device.serialNumber;
    [self sendDebugLog:[NSString stringWithFormat:@"🎉 BG5S RESULT: %ld mg/dL (dataID: %@)", (long)result, dataID]];
    
    [self sendEventSafe:@"onBloodGlucoseReading" body:@{
        @"mac": mac ?: @"",
        @"type": @"BG5S",
        @"value": @(result),
        @"unit": @"mg/dL",
        @"dataID": dataID ?: @"",
        @"source": @"live",
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

    for (NSString *type in deviceTypes) {
        // Special handling for BG5S - use CoreBluetooth instead of broken SDK scan
        if ([type isEqualToString:@"BG5S"]) {
            [self sendDebugLog:@"📶 Scan: Using CoreBluetooth for BG5S discovery (SDK scan is broken)"];
            _scanningForBG5S = YES;
            [self startCoreBluetoothScanForBG5S];
            continue;
        }
        
        HealthDeviceType dt = [self deviceTypeFromString:type];
        [self sendDebugLog:[NSString stringWithFormat:@"📶 Scan: Starting SDK scan for %@ (enum=%d)", type, (int)dt]];
        int result = [scanner commandScanDeviceType:dt];
        [self sendDebugLog:[NSString stringWithFormat:@"📶 Scan: result=%d (1=success)", result]];
    }

    [self sendEventSafe:@"onScanStateChanged" body:@{@"scanning": @YES}];
    resolve(nil);
}

RCT_EXPORT_METHOD(stopScan:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:@"📶 Scan: Stopping all scans"];
    
    // Stop CoreBluetooth scan for BG5S
    [self stopCoreBluetoothScan];
    
    // Stop iHealth SDK scans
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

#pragma mark - Connection (FIXED - now actually initiates connection!)

RCT_EXPORT_METHOD(connectDevice:(NSString *)mac
                  deviceType:(NSString *)deviceType
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 Connect: Initiating connection to %@ (%@)", mac, deviceType]];

    _targetMAC = mac;
    _targetType = deviceType;

    // BG5S needs CoreBluetooth connection since SDK scan doesn't discover it
    if ([deviceType isEqualToString:@"BG5S"]) {
        [self sendDebugLog:@"🔌 BG5S: Using CoreBluetooth connection path"];
        
        CBPeripheral *peripheral = [self findBG5SPeripheralBySerial:mac];
        if (peripheral) {
            [self connectBG5SPeripheral:peripheral serial:mac];
            resolve(@YES);
        } else {
            [self sendDebugLog:@"🔌 BG5S: Peripheral not found - need to scan first"];
            
            // Start scanning to find the device
            _scanningForBG5S = YES;
            [self startCoreBluetoothScanForBG5S];
            
            // Return success - the scan will find and connect when device is discovered
            resolve(@YES);
        }
        return;
    }

    // For other devices, use SDK connection
    ConnectDeviceController *connector = [ConnectDeviceController commandGetInstance];
    HealthDeviceType dt = [self deviceTypeFromString:deviceType];
    int result = [connector commandContectDeviceWithDeviceType:dt andSerialNub:mac];
    
    [self sendDebugLog:[NSString stringWithFormat:@"🔌 Connect command result: %d (1=success, 0=fail)", result]];
    
    if (result == 1) {
        resolve(@YES);
    } else {
        [self sendDebugLog:@"🔌 Connect: Failed - device may not be in range or not advertising"];
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
        // Try SDK disconnect first
        BG5S *device = [self getBG5SWithMac:mac];
        if (device) {
            [device disconnectDevice];
        }
        // Also disconnect CoreBluetooth peripheral
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
    
    // Also disconnect CoreBluetooth BG5S peripheral
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
            // Re-start measurement mode
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
                        @"mac": mac,
                        @"type": @"HS2",
                        @"weight": weight,
                        @"unit": @"kg",
                        @"source": @"offline"
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
            [device commandEnergy:^(NSNumber *energyValue) {
                resolve(energyValue);
            } errorBlock:^(BPDeviceError error) {
                resolve(@(-1));
            }];
            return;
        }
    }
    else if ([type isEqualToString:@"BP5"]) {
        BP5 *device = [self getBP5WithMac:mac];
        if (device) {
            [device commandEnergy:^(NSNumber *energyValue) {
                resolve(energyValue);
            } errorBlock:^(BPDeviceError error) {
                resolve(@(-1));
            }];
            return;
        }
    }
    else if ([type isEqualToString:@"BP5S"]) {
        BP5S *device = [self getBP5SWithMac:mac];
        if (device) {
            [device commandEnergy:^(NSNumber *energyValue) {
                resolve(energyValue);
            } errorBlock:^(BPDeviceError error) {
                resolve(@(-1));
            }];
            return;
        }
    }
    else if ([type isEqualToString:@"HS2"]) {
        HS2 *device = [self getHS2WithMac:mac];
        if (device) {
            [device commandGetHS2Battery:^(NSNumber *battery) {
                resolve(battery);
            } DiaposeErrorBlock:^(HS2DeviceError error) {
                resolve(@(-1));
            }];
            return;
        }
    }
    else if ([type isEqualToString:@"BG5"]) {
        BG5 *device = [self getBG5WithMac:mac];
        if (device) {
            [device commandQueryBattery:^(NSNumber *energy) {
                resolve(energy);
            } DisposeErrorBlock:^(NSNumber *errorID) {
                resolve(@(-1));
            }];
            return;
        }
    }
    else if ([type isEqualToString:@"BG5S"]) {
        BG5S *device = [self getBG5SWithMac:mac];
        if (device) {
            [device queryStateInfoWithSuccess:^(BG5SStateInfo *stateInfo) {
                resolve(@(stateInfo.batteryValue));
            } errorBlock:^(BG5SError error, NSString *detailInfo) {
                resolve(@(-1));
            }];
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

// Send arbitrary hex command to BG5S
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

// Get protocol log for analysis
RCT_EXPORT_METHOD(getBG5SProtocolLog:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    resolve(_bg5sRxLog ?: @[]);
}

// Clear protocol log
RCT_EXPORT_METHOD(clearBG5SProtocolLog:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [_bg5sRxLog removeAllObjects];
    resolve(@YES);
}

@end
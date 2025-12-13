#import "IHealthDevices.h"
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
@interface IHealthDevices () <BG5SDelegate>
@end

@implementation IHealthDevices {
    BOOL _isAuthenticated;
    BOOL _hasListeners;
    BOOL _controllersInitialized;
    NSMutableDictionary *_connectedDevices;
    NSString *_targetMAC;
    NSString *_targetType;
}

RCT_EXPORT_MODULE();

- (instancetype)init {
    self = [super init];
    if (self) {
        _isAuthenticated = NO;
        _controllersInitialized = NO;
        _connectedDevices = [NSMutableDictionary new];
        [self registerNotifications];
    }
    return self;
}

- (void)dealloc {
    [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (NSArray<NSString *> *)supportedEvents {
    return @[@"onDeviceFound", @"onConnectionStateChanged", @"onScanStateChanged",
             @"onBloodPressureReading", @"onBloodGlucoseReading", @"onWeightReading",
             @"onError", @"onDebugLog"];
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
    
    // BG5S
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
        @"rssi": info[@"RSSI"] ?: @(-50)
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
    [self sendDebugLog:@"🩸 BG5S: Connected - querying status..."];
    
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
        
        [self sendDebugLog:@"🩸 BG5S: Ready - insert test strip to begin measurement"];
        
    } errorBlock:^(BG5SError error, NSString *detailInfo) {
        [self sendDebugLog:[NSString stringWithFormat:@"🩸 BG5S status error: %d - %@", (int)error, detailInfo]];
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
    if (state == BG5SStripState_Insert) {
        [self sendDebugLog:@"🩸 BG5S: Strip INSERTED - apply blood sample"];
    } else {
        [self sendDebugLog:@"🩸 BG5S: Strip REMOVED"];
    }
}

- (void)deviceDropBlood:(BG5S *)device {
    [self sendDebugLog:@"🩸 BG5S: Blood detected - measuring..."];
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
        HealthDeviceType dt = [self deviceTypeFromString:type];
        [self sendDebugLog:[NSString stringWithFormat:@"📶 Scan: Starting scan for %@ (enum=%d)", type, (int)dt]];
        int result = [scanner commandScanDeviceType:dt];
        [self sendDebugLog:[NSString stringWithFormat:@"📶 Scan: result=%d (1=success)", result]];
    }

    [self sendEventSafe:@"onScanStateChanged" body:@{@"scanning": @YES}];
    resolve(nil);
}

RCT_EXPORT_METHOD(stopScan:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject) {
    [self sendDebugLog:@"📶 Scan: Stopping all scans"];
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

    // ACTUALLY initiate the connection - don't just set targets!
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
        BG5S *device = [self getBG5SWithMac:mac];
        if (device) [device disconnectDevice];
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

@end

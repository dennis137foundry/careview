//
//  CgmBackground.h
//  Wakes CareView when the Dexcom app saves new glucose readings to Apple Health,
//  so cgmSyncService can send them to the EMR while the app is in the background.
//

#import <React/RCTEventEmitter.h>
#import <React/RCTBridgeModule.h>

@interface CgmBackground : RCTEventEmitter <RCTBridgeModule>
@end

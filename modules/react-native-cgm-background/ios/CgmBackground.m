//
//  CgmBackground.m
//
//  HealthKit background delivery for blood glucose (Dexcom CGM, 2026-10).
//
//  The Dexcom app writes every sensor reading to Apple Health (~3 h late). An
//  HKObserverQuery with background delivery makes iOS launch or resume CareView
//  when new glucose samples arrive; this module then emits "CgmNewData" to JS,
//  which reads and sends them (cgmSyncService) and calls finished(), which
//  completes the observer so iOS keeps delivering.
//
//  Apple requires the observer query to be set up at every launch, as early as
//  possible: a constructor function observes UIApplicationDidFinishLaunchingNotification
//  (no AppDelegate change needed), but only once the patient has tapped Connect
//  (enable() stores the flag). Background delivery needs the entitlement
//  com.apple.developer.healthkit.background-delivery.
//
//  A completion handler that JS never finishes is completed after 25 s so iOS
//  does not throttle the app.
//

#import "CgmBackground.h"
#import <HealthKit/HealthKit.h>
#import <UIKit/UIKit.h>

static NSString *const kEnabledKey = @"cgmBackgroundEnabled";
static NSString *const kEventName = @"CgmNewData";

static HKHealthStore *sStore = nil;
static HKObserverQuery *sQuery = nil;
static NSMutableArray *sPending = nil;      // HKObserverQueryCompletionHandler blocks
static BOOL sEventWaiting = NO;             // data arrived before JS listened
static __weak CgmBackground *sInstance = nil;

@interface CgmBackground ()
+ (void)startQuery;
@end

@implementation CgmBackground
{
  BOOL _hasListeners;
}

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

- (instancetype)init
{
  if ((self = [super init])) {
    sInstance = self;
  }
  return self;
}

- (NSArray<NSString *> *)supportedEvents
{
  return @[ kEventName ];
}

- (void)startObserving
{
  _hasListeners = YES;
  @synchronized ([CgmBackground class]) {
    if (sEventWaiting) {
      sEventWaiting = NO;
      [self sendEventWithName:kEventName body:@{ @"reason" : @"healthkit" }];
    }
  }
}

- (void)stopObserving
{
  _hasListeners = NO;
}

- (BOOL)hasListeners
{
  return _hasListeners;
}

#pragma mark - Observer

+ (void)startQuery
{
  if (![HKHealthStore isHealthDataAvailable]) {
    return;
  }
  @synchronized ([CgmBackground class]) {
    if (sQuery != nil) {
      return;
    }
    if (sStore == nil) {
      sStore = [[HKHealthStore alloc] init];
    }
    if (sPending == nil) {
      sPending = [NSMutableArray array];
    }

    HKQuantityType *glucose = [HKObjectType quantityTypeForIdentifier:HKQuantityTypeIdentifierBloodGlucose];

    sQuery = [[HKObserverQuery alloc]
        initWithSampleType:glucose
                 predicate:nil
             updateHandler:^(__unused HKObserverQuery *query,
                             HKObserverQueryCompletionHandler completionHandler,
                             NSError *error) {
               if (error != nil) {
                 completionHandler();
                 return;
               }
               [CgmBackground deliver:completionHandler];
             }];
    [sStore executeQuery:sQuery];

    [sStore enableBackgroundDeliveryForType:glucose
                                  frequency:HKUpdateFrequencyImmediate
                             withCompletion:^(BOOL success, NSError *error) {
                               if (!success) {
                                 NSLog(@"[CgmBackground] background delivery not enabled: %@", error);
                               }
                             }];
  }
}

+ (void)stopQuery
{
  @synchronized ([CgmBackground class]) {
    if (sStore != nil && sQuery != nil) {
      [sStore stopQuery:sQuery];
      HKQuantityType *glucose = [HKObjectType quantityTypeForIdentifier:HKQuantityTypeIdentifierBloodGlucose];
      [sStore disableBackgroundDeliveryForType:glucose
                                withCompletion:^(__unused BOOL success, __unused NSError *error){
                                }];
    }
    sQuery = nil;
    [CgmBackground completeAll];
  }
}

+ (void)deliver:(HKObserverQueryCompletionHandler)completionHandler
{
  @synchronized ([CgmBackground class]) {
    [sPending addObject:[completionHandler copy]];
    CgmBackground *instance = sInstance;
    if (instance != nil && [instance hasListeners]) {
      [instance sendEventWithName:kEventName body:@{ @"reason" : @"healthkit" }];
    } else {
      sEventWaiting = YES;
    }
  }
  // Never leave iOS waiting: complete anything JS has not finished in 25 s.
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(25 * NSEC_PER_SEC)),
                 dispatch_get_main_queue(), ^{
                   [CgmBackground completeAll];
                 });
}

+ (void)completeAll
{
  NSArray *handlers;
  @synchronized ([CgmBackground class]) {
    handlers = [sPending copy];
    [sPending removeAllObjects];
  }
  for (HKObserverQueryCompletionHandler handler in handlers) {
    handler();
  }
}

#pragma mark - JS API

/** After Connect: observe from now on and at every future launch. */
RCT_EXPORT_METHOD(enable)
{
  [[NSUserDefaults standardUserDefaults] setBool:YES forKey:kEnabledKey];
  [CgmBackground startQuery];
}

/** After Stop: no more background wake-ups. */
RCT_EXPORT_METHOD(disable)
{
  [[NSUserDefaults standardUserDefaults] setBool:NO forKey:kEnabledKey];
  [CgmBackground stopQuery];
}

/** JS has sent the new readings: let iOS know this delivery is handled. */
RCT_EXPORT_METHOD(finished)
{
  [CgmBackground completeAll];
}

@end

#pragma mark - Launch hook

// Runs when the app binary loads (before main). Not +load: RCT_EXPORT_MODULE()
// already defines +load to register the module, and a second one does not compile.
// Apple wants the observer query set up at every launch, so observe the end of
// didFinishLaunching and start it then if the patient has connected.
__attribute__((constructor)) static void CgmBackgroundInstallLaunchHook(void)
{
  @autoreleasepool {
    [[NSNotificationCenter defaultCenter]
        addObserverForName:UIApplicationDidFinishLaunchingNotification
                    object:nil
                     queue:nil
                usingBlock:^(__unused NSNotification *note) {
                  if ([[NSUserDefaults standardUserDefaults] boolForKey:kEnabledKey]) {
                    [CgmBackground startQuery];
                  }
                }];
  }
}

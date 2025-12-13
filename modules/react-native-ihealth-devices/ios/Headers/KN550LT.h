//
//  KN550LT.h
//
//  Created by dai on 24-02-27.
//  Copyright (c) 2024年 my. All rights reserved.
//

#import <Foundation/Foundation.h>
#import "UIKit/UIKit.h"
#import "BPDevice.h"


@class KN550LTInternal;


 /**
 
  KN550LT device class
 
 */
@interface KN550LT : BPDevice

/// An internal instance, not available for SDK users
@property (strong, nonatomic) KN550LTInternal *internalDevice;


/**
 * Get IDPS info
 * @param idpsInfo  A block to refer ‘idpsInfo’.
 * @param error   A block to return the error.
 */
-(void)commandGetIDPSInfo:(BlockDeviceIDPS)idpsInfo errorBlock:(BlockError)error;


/**
 * Query battery remaining energy.
 * @param energyValue  A block to return the device battery remaining energy percentage, ‘80’ stands for 80%.
 * @param error  A block to return the error in ‘Establish measurement connection’
 */
-(void)commandEnergy:(BlockEnergyValue)energyValue errorBlock:(BlockError)error;

/**
 *
 * What the function returns:
 {
     currentUser = 1;
     upAirMeasureFlg = 0;
     deviceSysTime = 2024-08-19 08:10:58 +0000;
     haveOffline = 1;
     deviceTime = 2024-06-30 16:59:13 +0000;
     haveCuffLooseFlg = 1;
     haveBodyMovementFlg = 1;
     showUnit = 0;
     is24Hour = 1;
     selfUpdate = 0;
     firmwareVersion = "1.0.4";
     haveAngleSet = 0;
     armMeasureFlg = 1;
     haveShowUnitSetting = 0;
     mutableUpload = 0;
     haveBackLightSetting = 0;
     haveClockShowSetting = 0;
     hardwareVersion = "1.0.0";
     haveAngleSensor = 0;
     memoryGroup = 2;
     maxMemoryCapacity = 120;
     haveRepeatedlyMeasure = 0;
     haveHSD = 0;
 }
 * @param function  A block to return the function and states that the device supports.
 * @param error   A block to return the error.
 */
-(void)commandFunction:(BlockDeviceFunction)function errorBlock:(BlockError)error;


/**
 * Upload offline data total Count.
 * @param  totalCount item quantity of total data count
 * @param error  A block to return the error.
 */
-(void)commandTransferMemoryCount:(BlockBachCount)totalCount errorBlock:(BlockError)error;

/**
 * Upload offline data（Please call the API for obtaining the number of historical data before calling this API, otherwise the data cannot be obtained.）
 * @param uploadDataArray item quantity of total data.
 * @param error  A block to return the error.
 */
-(void)commandTransferMemoryData:(BlockBachArray)uploadDataArray errorBlock:(BlockError)error;
 
/**
 * Delete offline data.
 * @param success   A block to refer ‘set success’.
 * @param error    A block to return the error.
 */
-(void)commandDeleteMemoryDataResult:(BlockSuccess)success errorBlock:(BlockError)error;

/**
 * Get Device Date.（
 * @param  date The block return Date      "2020-01-01 08:56:38"
 * @param error   error codes.
 */
-(void)commandGetDeviceDate:(BlockDeviceDate)date errorBlock:(BlockError)error;

/**
 * Disconnect current device
 */
-(void)commandDisconnectDevice;

@end

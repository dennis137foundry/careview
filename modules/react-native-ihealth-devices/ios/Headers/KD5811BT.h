//
//  KD5811BT.h
//
//  Created by dai on 24-02-27.
//  Copyright (c) 2024年 my. All rights reserved.
//

#import <Foundation/Foundation.h>
#import "UIKit/UIKit.h"
#import "BPDevice.h"


@class KD5811BTInternal;


typedef NS_ENUM(uint8_t,MemoryDataGroupNumber) {
    MemoryDataGroupNumber_Group1             = 0x00,
    MemoryDataGroupNumber_Group2             = 0x01,
    MemoryDataGroupNumber_All                = 0xFE,
};

 /**
 
  KD5811BT device class
 
 */
@interface KD5811BT : BPDevice

/// An internal instance, not available for SDK users
@property (strong, nonatomic) KD5811BTInternal *internalDevice;

/**
 * synchronize time
 * @param success  A block to refer ‘set success’.
 * @param error   A block to return the error.
 */
-(void)commandSynchronizeTime:(BlockSuccess)success errorBlock:(BlockError)error;

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
 *  Import parameter:
 * @param groupID    MemoryDataGroupNumber。
 *
 * return
 * @param  totalCount item quantity of total data count
 * @param error  A block to return the error.
 */
-(void)commandGetMemoryCountWithGroupID:(MemoryDataGroupNumber)groupID count:(BlockBachCount)totalCount errorBlock:(BlockError)error;

/**
 * Upload offline data（Please call the API for obtaining the number of historical data before calling this API, otherwise the data cannot be obtained.）
 *
 * Import parameter:
 * @param groupID   MemoryDataGroupNumber。
 *
 * @param uploadDataArray item quantity of total data.
 * @param error  A block to return the error.
 */
-(void)commandTransferMemoryDataWithGroupID:(MemoryDataGroupNumber)groupID data:(BlockBachArray)uploadDataArray errorBlock:(BlockError)error;
 
/**
 * Delete offline data.
 *
 * * Import parameter:
 * @param groupID  MemoryDataGroupNumber
 * 
 * @param success   A block to refer ‘set success’.
 * @param error    A block to return the error.
 */
-(void)commandDeleteMemoryDataWithGroupID:(MemoryDataGroupNumber)groupID success:(BlockSuccess)success errorBlock:(BlockError)error;

/**
 * Disconnect current device
 */
-(void)commandDisconnectDevice;

@end

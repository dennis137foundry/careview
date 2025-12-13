//
//  KD5811BTController.h
//
//  Created by dai on 24-02-27.
//  Copyright (c) 2024年 my. All rights reserved.
//

#import <Foundation/Foundation.h>
#import "KD5811BT.h"
#import "KD5811BTController.h"
@class KD5811BT;


@interface KD5811BTController : NSObject
/**
 * Initialize KD5811BT controller class
 */
+(KD5811BTController *_Nullable)shareIHKD5811BTController;

/**
 * Get all KD5811BT instance,use hsInstance to call BP related communication methods.
 */
-(NSArray *_Nullable)getAllCurrentKD5811BTInstace;

/// Get KD5811BT Instance
/// @param mac mac or serial number
/// Suggestion: Use weak when defining the object of KD5811BT. Using strong may cause the object to not be cleaned up when disconnected.
- (nullable KD5811BT *)getInstanceWithMac:(NSString*_Nullable)mac;

@end

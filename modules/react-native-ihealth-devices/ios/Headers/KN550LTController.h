//
//  KN550LTController.h
//  testShareCommunication
//
//  Created by my on 8/10/13.
//  Copyright (c) 2013年 my. All rights reserved.
//

#import <Foundation/Foundation.h>
#import "KN550LT.h"
#import "KN550LTController.h"
@class KN550LT;

/**
 KN550LT controller class
 */
@interface KN550LTController : NSObject
/**
 * Initialize KN550LT controller class
 */
+(KN550LTController *_Nullable)shareIHKN550LTController;

/**
 * Get all KN550LT instance,use hsInstance to call BP related communication methods.
 */
-(NSArray *_Nullable)getAllCurrentKN550LTInstace;

/// Get KN550LT Instance
/// @param mac mac or serial number
/// Suggestion: Use weak when defining the object of KN550LT. Using strong may cause the object to not be cleaned up when disconnected.
- (nullable KN550LT *)getInstanceWithMac:(NSString*_Nullable)mac;




@end

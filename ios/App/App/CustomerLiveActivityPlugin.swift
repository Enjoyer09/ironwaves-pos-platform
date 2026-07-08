//
//  CustomerLiveActivityPlugin.swift
//  iRonWaves Loyalty
//
//  Capacitor plugin bridge for Live Activities (iOS 16.1+)
//  Exposes start/update/end methods to the JavaScript layer.
//

import Foundation
import Capacitor

@objc(CustomerLiveActivityPlugin)
public class CustomerLiveActivityPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CustomerLiveActivityPlugin"
    public let jsName = "CustomerLiveActivity"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "update", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "end", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isSupported", returnType: CAPPluginReturnPromise)
    ]

    // MARK: - Start Live Activity

    @objc func start(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities require iOS 16.1+")
            return
        }

        let customerName = call.getString("customerName") ?? "Guest"
        let programMode = call.getString("programMode") ?? "points"
        let starsBalance = call.getDouble("starsBalance") ?? 0.0
        let progressPercent = call.getInt("progressPercent") ?? 0
        let rewardName = call.getString("rewardName") ?? "Reward"
        let isCashback = call.getBool("isCashback") ?? false
        let cashbackPercent = call.getDouble("cashbackPercent") ?? 0.0

        let activityId = LiveActivityManager.start(
            customerName: customerName,
            programMode: programMode,
            starsBalance: starsBalance,
            progressPercent: progressPercent,
            rewardName: rewardName,
            isCashback: isCashback,
            cashbackPercent: cashbackPercent
        )

        if let id = activityId {
            call.resolve(["activityId": id])
        } else {
            call.reject("Failed to start Live Activity")
        }
    }

    // MARK: - Update Live Activity

    @objc func update(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities require iOS 16.1+")
            return
        }

        let starsBalance = call.getDouble("starsBalance") ?? 0.0
        let progressPercent = call.getInt("progressPercent") ?? 0
        let rewardName = call.getString("rewardName") ?? "Reward"
        let isCashback = call.getBool("isCashback") ?? false
        let cashbackPercent = call.getDouble("cashbackPercent") ?? 0.0

        LiveActivityManager.update(
            starsBalance: starsBalance,
            progressPercent: progressPercent,
            rewardName: rewardName,
            isCashback: isCashback,
            cashbackPercent: cashbackPercent
        )

        call.resolve()
    }

    // MARK: - End Live Activity

    @objc func end(_ call: CAPPluginCall) {
        guard #available(iOS 16.1, *) else {
            call.reject("Live Activities require iOS 16.1+")
            return
        }

        LiveActivityManager.end()
        call.resolve()
    }

    // MARK: - Check Support

    @objc func isSupported(_ call: CAPPluginCall) {
        if #available(iOS 16.1, *) {
            call.resolve(["supported": true])
        } else {
            call.resolve(["supported": false])
        }
    }
}

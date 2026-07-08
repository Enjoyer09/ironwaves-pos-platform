import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Note: Push notification registration is deferred to Capacitor's PushNotifications.requestPermissions()
        // called from TypeScript after the user has opted in (see CustomerApp.tsx)
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused while the application was inactive.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Custom URL scheme handling (e.g. ironwaves://customer?cardId=xxx&token=yyy)
        if handleCustomUrl(url) { return true }
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Universal Links (e.g. https://ironwaves.store/customer?id=xxx&token=yyy)
        if handleUniversalLink(userActivity) { return true }
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: - Push Notification Delegates

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenParts = deviceToken.map { data in String(format: "%02.2hhx", data) }
        let token = tokenParts.joined()
        NotificationCenter.default.post(name: Notification.Name("CAPPushTokenReceived"), object: nil, userInfo: ["token": token])
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Failed to register for remote notifications: \(error.localizedDescription)")
    }

    // MARK: - Deep Link Handlers

    /// Handle custom URL scheme: ironwaves://customer?...
    private func handleCustomUrl(_ url: URL) -> Bool {
        guard let scheme = url.scheme?.lowercased(),
              scheme == "ironwaves" || scheme == "ironwavesloyalty" else { return false }

        // Post notification so Capacitor's App plugin can pick it up
        NotificationCenter.default.post(
            name: Notification.Name("CAPOpenURL"),
            object: nil,
            userInfo: ["url": url]
        )
        return true
    }

    /// Handle Universal Links: https://ironwaves.store/customer?...
    private func handleUniversalLink(_ userActivity: NSUserActivity) -> Bool {
        guard userActivity.activityType == NSUserActivityTypeBrowsingWeb,
              let url = userActivity.webpageURL else { return false }

        // Check if this is a customer deep link
        let path = url.path.lowercased()
        if path.hasPrefix("/customer") || path.hasPrefix("/c/") {
            // Post notification so the web app can handle the deep link
            NotificationCenter.default.post(
                name: Notification.Name("CAPOpenURL"),
                object: nil,
                userInfo: ["url": url]
            )
            return true
        }

        return false
    }
}

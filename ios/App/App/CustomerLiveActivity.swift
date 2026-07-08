//
//  CustomerLiveActivity.swift
//  iRonWaves Loyalty
//
//  Live Activity for iOS 16.1+ Dynamic Island & Lock Screen.
//  Displays the customer's current star/cashback balance in real-time.
//

import ActivityKit
import WidgetKit
import SwiftUI

// MARK: - Activity Attributes

public struct CustomerBalanceAttributes: ActivityAttributes {
    public struct ContentState: Codable & Hashable {
        // Dynamic data that updates during the activity
        public var starsBalance: Double
        public var progressPercent: Int
        public var rewardName: String
        public var isCashback: Bool
        public var cashbackPercent: Double
    }

    // Static data that doesn't change
    public var customerName: String
    public var programMode: String // "points" or "cashback"
}

// MARK: - Live Activity Widget

@available(iOS 16.1, *)
struct CustomerBalanceLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CustomerBalanceAttributes.self) { context in
            // Lock Screen / Banner view
            CustomerBalanceLockScreenView(context: context)
        } dynamicIsland: { context in
            // Dynamic Island view
            DynamicIsland {
                // Expanded view (when user long-presses the island)
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .foregroundColor(.orange)
                            .font(.caption)
                        Text("\(context.state.starsBalance, specifier: "%.0f")")
                            .font(.headline)
                            .fontWeight(.black)
                            .foregroundColor(.white)
                    }
                }
                DynamicIslandExpandedRegion(.trailing) {
                    if context.state.isCashback {
                        Text("\(context.state.cashbackPercent, specifier: "%.0f")%")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundColor(.orange)
                    } else {
                        Text("\(context.state.progressPercent)%")
                            .font(.caption)
                            .fontWeight(.bold)
                            .foregroundColor(.orange)
                    }
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(context.state.rewardName)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    ProgressView(value: Double(context.state.progressPercent), total: 100)
                        .tint(.orange)
                        .padding(.horizontal)
                }
            } compactLeading: {
                // Compact leading (default state)
                HStack(spacing: 2) {
                    Image(systemName: "star.fill")
                        .foregroundColor(.orange)
                        .font(.caption2)
                    Text("\(context.state.starsBalance, specifier: "%.0f")")
                        .font(.caption2)
                        .fontWeight(.bold)
                        .foregroundColor(.white)
                }
            } compactTrailing: {
                // Compact trailing (default state)
                Text("\(context.state.progressPercent)%")
                    .font(.caption2)
                    .fontWeight(.bold)
                    .foregroundColor(.orange)
            } minimal: {
                // Minimal view (when another app is using the island)
                Image(systemName: "cup.and.saucer.fill")
                    .foregroundColor(.orange)
            }
        }
    }
}

// MARK: - Lock Screen View

@available(iOS 16.1, *)
struct CustomerBalanceLockScreenView: View {
    let context: ActivityViewContext<CustomerBalanceAttributes>

    var body: some View {
        HStack(spacing: 16) {
            // Left: Icon
            ZStack {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.orange.opacity(0.15))
                    .frame(width: 48, height: 48)
                Image(systemName: "cup.and.saucer.fill")
                    .font(.title3)
                    .foregroundColor(.orange)
            }

            // Center: Balance info
            VStack(alignment: .leading, spacing: 2) {
                Text(context.attributes.customerName)
                    .font(.headline)
                    .fontWeight(.bold)
                    .foregroundColor(.primary)
                HStack(spacing: 4) {
                    Image(systemName: "star.fill")
                        .foregroundColor(.orange)
                        .font(.caption)
                    Text("\(context.state.starsBalance, specifier: "%.1f")")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundColor(.secondary)
                    if context.state.isCashback {
                        Text("• \(context.state.cashbackPercent, specifier: "%.0f")% cashback")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }
            }

            Spacer()

            // Right: Progress
            VStack(alignment: .trailing, spacing: 2) {
                Text(context.state.rewardName)
                    .font(.caption)
                    .fontWeight(.bold)
                    .foregroundColor(.orange)
                ProgressView(value: Double(context.state.progressPercent), total: 100)
                    .tint(.orange)
                    .frame(width: 60)
            }
        }
        .padding()
        .activityBackgroundTint(Color.black.opacity(0.85))
        .activitySystemActionForegroundColor(Color.orange)
    }
}

// MARK: - Live Activity Manager (called from TypeScript via plugin)

@available(iOS 16.1, *)
public class LiveActivityManager {
    static var currentActivity: Activity<CustomerBalanceAttributes>? = nil

    /// Start a new Live Activity with the customer's current balance
    @discardableResult
    public static func start(
        customerName: String,
        programMode: String,
        starsBalance: Double,
        progressPercent: Int,
        rewardName: String,
        isCashback: Bool,
        cashbackPercent: Double
    ) -> String? {
        // End any existing activity first
        if let existing = currentActivity {
            Task { await existing.end(dismissalPolicy: .immediate) }
        }

        let attributes = CustomerBalanceAttributes(
            customerName: customerName,
            programMode: programMode
        )

        let contentState = CustomerBalanceAttributes.ContentState(
            starsBalance: starsBalance,
            progressPercent: progressPercent,
            rewardName: rewardName,
            isCashback: isCashback,
            cashbackPercent: cashbackPercent
        )

        do {
            let activity = try Activity.request(
                attributes: attributes,
                content: .init(state: contentState, staleDate: nil)
            )
            currentActivity = activity
            return activity.id
        } catch {
            print("Failed to start Live Activity: \(error.localizedDescription)")
            return nil
        }
    }

    /// Update the Live Activity with new balance data
    public static func update(
        starsBalance: Double,
        progressPercent: Int,
        rewardName: String,
        isCashback: Bool,
        cashbackPercent: Double
    ) {
        guard let activity = currentActivity else { return }

        let contentState = CustomerBalanceAttributes.ContentState(
            starsBalance: starsBalance,
            progressPercent: progressPercent,
            rewardName: rewardName,
            isCashback: isCashback,
            cashbackPercent: cashbackPercent
        )

        Task {
            await activity.update(
                .init(state: contentState, staleDate: Date().addingTimeInterval(15 * 60))
            )
        }
    }

    /// End the Live Activity
    public static func end() {
        guard let activity = currentActivity else { return }
        Task { await activity.end(dismissalPolicy: .immediate) }
        currentActivity = nil
    }
}

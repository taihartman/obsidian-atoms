import ActivityKit
import WidgetKit
import SwiftUI
import AtomsCaptureCore

@main
struct CaptureLiveActivityBundle: WidgetBundle {
    var body: some Widget {
        CaptureLiveActivity()
    }
}

struct CaptureLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: CaptureActivityAttributes.self) { context in
            HStack {
                Text("↵")
                    .font(.system(size: 22, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color(red: 10 / 255, green: 132 / 255, blue: 255 / 255))
                VStack(alignment: .leading, spacing: 2) {
                    Text(context.state.phase.title)
                        .font(.headline)
                    if !context.state.preview.isEmpty {
                        Text(context.state.preview)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
                Spacer()
            }
            .padding()
            .activityBackgroundTint(Color.black.opacity(0.85))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Text("↵")
                        .font(.system(size: 20, weight: .bold, design: .monospaced))
                        .foregroundStyle(Color(red: 10 / 255, green: 132 / 255, blue: 255 / 255))
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading) {
                        Text(context.state.phase.title)
                            .font(.headline)
                        Text(context.state.preview)
                            .font(.caption)
                            .lineLimit(2)
                    }
                }
                DynamicIslandExpandedRegion(.bottom) {
                    Text("Open Atoms Capture to edit or save")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }
            } compactLeading: {
                Text("↵")
                    .font(.system(size: 14, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color(red: 10 / 255, green: 132 / 255, blue: 255 / 255))
            } compactTrailing: {
                Text(context.state.phase == .listening ? "…" : context.state.phase.title)
                    .font(.caption2)
            } minimal: {
                Text("↵")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
            }
        }
    }
}

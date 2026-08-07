import WidgetKit
import SwiftUI
import AtomsCaptureCore

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date(), vaultName: "Vault")
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> Void) {
        let store = VaultStore()
        completion(SimpleEntry(date: Date(), vaultName: store.displayName))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SimpleEntry>) -> Void) {
        let store = VaultStore()
        let entry = SimpleEntry(date: Date(), vaultName: store.displayName)
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
    let vaultName: String?
}

struct AtomsCaptureWidgetEntryView: View {
    var entry: Provider.Entry

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("↵")
                .font(.system(size: 28, weight: .bold, design: .monospaced))
                .foregroundStyle(Color(red: 10 / 255, green: 132 / 255, blue: 255 / 255))
            Text("Capture")
                .font(.headline)
            if let name = entry.vaultName {
                Text(name)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text("Link vault in app")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) {
            Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255)
        }
        .widgetURL(URL(string: "atomscapture://capture"))
    }
}

@main
struct AtomsCaptureWidget: Widget {
    let kind = "AtomsCaptureWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: Provider()) { entry in
            AtomsCaptureWidgetEntryView(entry: entry)
        }
        .configurationDisplayName("Atoms Capture")
        .description("One tap to capture a thought into your vault inbox.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

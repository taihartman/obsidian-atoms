import WidgetKit
import SwiftUI
import AtomsCaptureCore

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> SimpleEntry {
        SimpleEntry(date: Date(), vaultName: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (SimpleEntry) -> Void) {
        completion(SimpleEntry(date: Date(), vaultName: VaultStore().displayName))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<SimpleEntry>) -> Void) {
        let entry = SimpleEntry(date: Date(), vaultName: VaultStore().displayName)
        completion(Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(3600))))
    }
}

struct SimpleEntry: TimelineEntry {
    let date: Date
    let vaultName: String?
}

struct AtomsCaptureWidgetEntryView: View {
    @Environment(\.colorScheme) private var colorScheme
    var entry: Provider.Entry

    private var card: Color {
        colorScheme == .dark
            ? Color(red: 28 / 255, green: 28 / 255, blue: 30 / 255)
            : Color.white
    }

    private var label: Color {
        colorScheme == .dark ? .white : .black
    }

    private var secondary: Color {
        colorScheme == .dark ? .white.opacity(0.45) : .black.opacity(0.45)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("↵")
                .font(.system(size: 28, weight: .bold, design: .monospaced))
                .foregroundStyle(Color(red: 10 / 255, green: 132 / 255, blue: 255 / 255))
            Text("Capture")
                .font(.headline)
                .foregroundStyle(label)
            Text(entry.vaultName ?? "Capture Atom")
                .font(.caption2)
                .foregroundStyle(secondary)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .containerBackground(for: .widget) {
            card
        }
        // SSOT name via ShortcutHandoff (DeliverySettings.captureAtomName)
        .widgetURL(ShortcutHandoff.runURL(body: nil))
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
        .description("Opens Capture Atom — type or speak into your vault inbox.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

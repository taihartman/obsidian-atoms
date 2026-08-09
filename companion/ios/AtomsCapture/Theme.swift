import SwiftUI

/// Mirrors companion/android AtomsTheme. Follows system light/dark.
enum AtomsTheme {
    static let tint = Color(red: 10 / 255, green: 132 / 255, blue: 255 / 255) // #0A84FF
    /// Section kickers on Android use Mind purple, not blue.
    static let mind = Color(red: 191 / 255, green: 90 / 255, blue: 242 / 255) // #BF5AF2
    static let done = Color(red: 48 / 255, green: 209 / 255, blue: 88 / 255) // #30D158
    static let error = Color(red: 255 / 255, green: 69 / 255, blue: 58 / 255) // #FF453A
    static let person = Color(red: 255 / 255, green: 159 / 255, blue: 10 / 255) // #FF9F0A

    static let bg = Color(uiColor: UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor.black
            : UIColor(red: 0.949, green: 0.949, blue: 0.969, alpha: 1)
    })

    static let card = Color(uiColor: UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(red: 0.110, green: 0.110, blue: 0.118, alpha: 1)
            : UIColor.white
    })

    static let elevated = Color(uiColor: UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(red: 0.173, green: 0.173, blue: 0.180, alpha: 1)
            : UIColor(red: 0.898, green: 0.898, blue: 0.918, alpha: 1)
    })

    static let label = Color(uiColor: UIColor { t in
        t.userInterfaceStyle == .dark ? .white : .black
    })

    static let secondary = Color(uiColor: UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(white: 0.92, alpha: 0.60)
            : UIColor(white: 0, alpha: 0.60)
    })

    static let tertiary = Color(uiColor: UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(white: 0.92, alpha: 0.32)
            : UIColor(white: 0, alpha: 0.32)
    })

    static let hairline = Color(uiColor: UIColor { t in
        t.userInterfaceStyle == .dark
            ? UIColor(white: 0.33, alpha: 0.55)
            : UIColor(white: 0, alpha: 0.20)
    })

    static let mark = "↵"
    static let fieldRadius: CGFloat = 14
    static let buttonRadius: CGFloat = 12
    static let cardRadius: CGFloat = 16

    /// Android kickerStyle — labelSmall + Mind purple + semibold
    static var kicker: Font {
        .system(size: 11, weight: .semibold)
    }

    /// Android claimSerifStyle — 18sp serif
    static var claim: Font {
        .system(size: 18, weight: .regular, design: .serif)
    }
}

struct AtomsFlatCard<Content: View>: View {
    @ViewBuilder var content: () -> Content

    var body: some View {
        content()
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(16)
            .background(AtomsTheme.card)
            .clipShape(RoundedRectangle(cornerRadius: AtomsTheme.cardRadius, style: .continuous))
    }
}

struct AtomsPrimaryButtonStyle: ButtonStyle {
    var enabled: Bool = true

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(Color.white)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .background(enabled ? AtomsTheme.tint : AtomsTheme.tint.opacity(0.35))
            .clipShape(RoundedRectangle(cornerRadius: AtomsTheme.buttonRadius, style: .continuous))
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}

struct AtomsSecondaryButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(AtomsTheme.label)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .background(AtomsTheme.elevated)
            .clipShape(RoundedRectangle(cornerRadius: AtomsTheme.buttonRadius, style: .continuous))
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}

struct AtomsOutlineButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 16, weight: .semibold))
            .foregroundStyle(AtomsTheme.label)
            .frame(maxWidth: .infinity)
            .frame(minHeight: 48)
            .background(Color.clear)
            .overlay(
                RoundedRectangle(cornerRadius: AtomsTheme.buttonRadius, style: .continuous)
                    .stroke(AtomsTheme.hairline, lineWidth: 1)
            )
            .opacity(configuration.isPressed ? 0.88 : 1)
    }
}

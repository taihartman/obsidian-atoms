// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "AtomsCaptureCore",
    platforms: [
        .iOS(.v17),
        .macOS(.v14),
    ],
    products: [
        .library(name: "AtomsCaptureCore", targets: ["AtomsCaptureCore"]),
    ],
    targets: [
        .target(name: "AtomsCaptureCore"),
        .testTarget(
            name: "AtomsCaptureCoreTests",
            dependencies: ["AtomsCaptureCore"]
        ),
    ]
)

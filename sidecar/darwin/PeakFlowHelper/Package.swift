// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "PeakFlowHelper",
    platforms: [.macOS(.v13)],
    targets: [
        .executableTarget(
            name: "PeakFlowHelper",
            path: "Sources",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("CoreAudio"),
                .linkedFramework("ApplicationServices")
            ]
        )
    ]
)

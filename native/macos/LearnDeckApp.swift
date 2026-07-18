import AppKit
import Darwin
import Foundation
import WebKit

private enum LaunchError: LocalizedError {
    case missingResource(String)
    case unableToCreateDirectory(String)
    case unableToCreateLog(String)
    case unableToFindPort
    case unableToStartServer(String)

    var errorDescription: String? {
        switch self {
        case .missingResource(let resource):
            return "The app bundle is missing \(resource)."
        case .unableToCreateDirectory(let path):
            return "LearnDeck could not create its data directory at \(path)."
        case .unableToCreateLog(let path):
            return "LearnDeck could not open its server log at \(path)."
        case .unableToFindPort:
            return "LearnDeck could not find a free local TCP port."
        case .unableToStartServer(let message):
            return "LearnDeck could not start its local server: \(message)"
        }
    }
}

private final class WebViewCoordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    private let localServerURL: URL

    init(localServerURL: URL) {
        self.localServerURL = localServerURL
        super.init()
    }

    func webView(
        _ webView: WKWebView,
        decidePolicyFor navigationAction: WKNavigationAction,
        decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
    ) {
        guard let url = navigationAction.request.url else {
            decisionHandler(.allow)
            return
        }

        let opensInNewWindow = navigationAction.targetFrame == nil
        let isLocalServerURL = url.scheme == localServerURL.scheme
            && url.host == localServerURL.host
            && url.port == localServerURL.port

        if opensInNewWindow || !isLocalServerURL {
            if let scheme = url.scheme?.lowercased(), ["http", "https", "mailto", "tel"].contains(scheme) {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
            return
        }

        decisionHandler(.allow)
    }

    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for navigationAction: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = navigationAction.request.url {
            NSWorkspace.shared.open(url)
        }
        return nil
    }
}

private func responderSelector(_ name: String) -> Selector {
    NSSelectorFromString(name)
}

@MainActor
private final class LearnDeckAppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    private var window: NSWindow?
    private var webView: WKWebView?
    private var webViewCoordinator: WebViewCoordinator?
    private var serverProcess: Process?
    private var serverLogHandle: FileHandle?
    private var serverProcessGroupIsolated = false
    private var signalSources: [DispatchSourceSignal] = []

    private var dataDirectory = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent("Library", isDirectory: true)
        .appendingPathComponent("Application Support", isDirectory: true)
        .appendingPathComponent("LearnDeck", isDirectory: true)
    private var logURL = URL(fileURLWithPath: NSHomeDirectory())
        .appendingPathComponent("Library", isDirectory: true)
        .appendingPathComponent("Application Support", isDirectory: true)
        .appendingPathComponent("LearnDeck", isDirectory: true)
        .appendingPathComponent("server.log")
    private var portFileURL: URL?
    private var pidFileURL: URL?

    func applicationDidFinishLaunching(_ notification: Notification) {
        configureMenuBar()
        installSignalHandlers()

        do {
            let serverURL = try launchServer()
            waitForServer(at: serverURL)
        } catch {
            showStartupFailure(error.localizedDescription)
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopServer()
        signalSources.forEach { $0.cancel() }
        signalSources.removeAll()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    private func configureMenuBar() {
        let menuBar = NSMenu()

        let applicationMenuItem = NSMenuItem()
        let applicationMenu = NSMenu(title: "LearnDeck")
        applicationMenu.addItem(withTitle: "About LearnDeck", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        applicationMenu.addItem(.separator())
        applicationMenu.addItem(withTitle: "Quit LearnDeck", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        applicationMenuItem.submenu = applicationMenu
        menuBar.addItem(applicationMenuItem)

        let editMenuItem = NSMenuItem()
        let editMenu = NSMenu(title: "Edit")
        editMenu.addItem(withTitle: "Undo", action: responderSelector("undo:"), keyEquivalent: "z")
        let redoItem = editMenu.addItem(withTitle: "Redo", action: responderSelector("redo:"), keyEquivalent: "Z")
        redoItem.keyEquivalentModifierMask = [.command, .shift]
        editMenu.addItem(.separator())
        editMenu.addItem(withTitle: "Cut", action: responderSelector("cut:"), keyEquivalent: "x")
        editMenu.addItem(withTitle: "Copy", action: responderSelector("copy:"), keyEquivalent: "c")
        editMenu.addItem(withTitle: "Paste", action: responderSelector("paste:"), keyEquivalent: "v")
        editMenu.addItem(withTitle: "Select All", action: responderSelector("selectAll:"), keyEquivalent: "a")
        editMenuItem.submenu = editMenu
        menuBar.addItem(editMenuItem)

        let windowMenuItem = NSMenuItem()
        let windowMenu = NSMenu(title: "Window")
        windowMenu.addItem(withTitle: "Minimize", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        windowMenu.addItem(withTitle: "Zoom", action: #selector(NSWindow.performZoom(_:)), keyEquivalent: "")
        windowMenu.addItem(withTitle: "Bring All to Front", action: #selector(NSApplication.arrangeInFront(_:)), keyEquivalent: "")
        windowMenuItem.submenu = windowMenu
        menuBar.addItem(windowMenuItem)

        NSApp.mainMenu = menuBar
        NSApp.windowsMenu = windowMenu
    }

    private func installSignalHandlers() {
        for signalNumber in [SIGTERM, SIGINT, SIGHUP] {
            Darwin.signal(signalNumber, SIG_IGN)
            let source = DispatchSource.makeSignalSource(signal: signalNumber, queue: .main)
            source.setEventHandler { [weak self] in
                self?.stopServer()
                NSApp.terminate(nil)
            }
            source.resume()
            signalSources.append(source)
        }
    }

    private func launchServer() throws -> URL {
        let fileManager = FileManager.default
        let applicationSupport = fileManager.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSHomeDirectory()).appendingPathComponent("Library/Application Support", isDirectory: true)
        dataDirectory = applicationSupport.appendingPathComponent("LearnDeck", isDirectory: true)
        logURL = dataDirectory.appendingPathComponent("server.log")
        portFileURL = dataDirectory.appendingPathComponent("server.port")
        pidFileURL = dataDirectory.appendingPathComponent("server.pid")

        do {
            try fileManager.createDirectory(at: dataDirectory, withIntermediateDirectories: true)
        } catch {
            throw LaunchError.unableToCreateDirectory(dataDirectory.path)
        }

        guard let resourceURL = Bundle.main.resourceURL else {
            throw LaunchError.missingResource("Contents/Resources")
        }
        let payloadURL = resourceURL.appendingPathComponent("learndeck", isDirectory: true)
        let serverExecutableURL = payloadURL.appendingPathComponent("learndeck-server")
        guard fileManager.fileExists(atPath: serverExecutableURL.path) else {
            throw LaunchError.missingResource("Contents/Resources/learndeck/learndeck-server")
        }

        guard let packageRoot = Bundle.main.object(forInfoDictionaryKey: "LearnDeckRoot") as? String,
              !packageRoot.isEmpty else {
            throw LaunchError.missingResource("LearnDeckRoot in Contents/Info.plist")
        }

        let port = try Self.findFreePort()
        let portURL = dataDirectory.appendingPathComponent("server.port")
        let pidURL = dataDirectory.appendingPathComponent("server.pid")
        try? fileManager.removeItem(at: portURL)
        try? fileManager.removeItem(at: pidURL)
        try String(port).write(to: portURL, atomically: true, encoding: .utf8)

        do {
            try Data().write(to: logURL, options: .atomic)
        } catch {
            throw LaunchError.unableToCreateLog(logURL.path)
        }
        guard let logHandle = FileHandle(forWritingAtPath: logURL.path) else {
            throw LaunchError.unableToCreateLog(logURL.path)
        }
        logHandle.seekToEndOfFile()

        var environment = ProcessInfo.processInfo.environment
        environment["LEARNDECK_PUBLIC_DIR"] = payloadURL.appendingPathComponent("public", isDirectory: true).path
        environment["LEARNDECK_COURSES_DIR"] = payloadURL.appendingPathComponent("courses", isDirectory: true).path
        environment["LEARNDECK_DB_PATH"] = dataDirectory.appendingPathComponent("progress.db").path
        environment["LEARNDECK_COURSE_CACHE_DIR"] = dataDirectory.appendingPathComponent("course-cache", isDirectory: true).path
        environment["LEARNDECK_ROOT"] = packageRoot
        environment["PORT"] = String(port)

        let process = Process()
        process.executableURL = serverExecutableURL
        process.currentDirectoryURL = payloadURL
        process.environment = environment
        process.standardOutput = logHandle
        process.standardError = logHandle

        do {
            try process.run()
        } catch {
            try? logHandle.close()
            throw LaunchError.unableToStartServer(error.localizedDescription)
        }

        serverProcess = process
        serverLogHandle = logHandle
        let processID = process.processIdentifier
        serverProcessGroupIsolated = Darwin.setpgid(processID, processID) == 0
        try? String(processID).write(to: pidURL, atomically: true, encoding: .utf8)

        return URL(string: "http://127.0.0.1:\(port)/")!
    }

    private func waitForServer(at url: URL) {
        Task { [weak self] in
            let ready = await Self.serverIsReady(at: url)
            guard let self else { return }
            if ready {
                self.showWindow(for: url)
            } else {
                self.showStartupFailure("The server did not return HTTP 200 from / before the startup timeout.")
            }
        }
    }

    private nonisolated static func serverIsReady(at url: URL) async -> Bool {
        let deadline = Date().addingTimeInterval(20)
        while Date() < deadline {
            var request = URLRequest(url: url)
            request.timeoutInterval = 1
            do {
                let (_, response) = try await URLSession.shared.data(for: request)
                if (response as? HTTPURLResponse)?.statusCode == 200 {
                    return true
                }
            } catch {
                // The server may still be binding its port; keep polling until the deadline.
            }
            try? await Task.sleep(nanoseconds: 250_000_000)
        }
        return false
    }

    private func showWindow(for serverURL: URL) {
        let configuration = WKWebViewConfiguration()
        let coordinator = WebViewCoordinator(localServerURL: serverURL)
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.navigationDelegate = coordinator
        view.uiDelegate = coordinator
        view.autoresizingMask = [.width, .height]

        let newWindow = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1280, height: 860),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        newWindow.title = "LearnDeck"
        newWindow.minSize = NSSize(width: 980, height: 700)
        newWindow.contentView = view
        newWindow.delegate = self
        newWindow.isReleasedWhenClosed = false
        newWindow.center()
        newWindow.makeKeyAndOrderFront(nil)

        webViewCoordinator = coordinator
        webView = view
        window = newWindow
        view.load(URLRequest(url: serverURL))
        NSApp.activate(ignoringOtherApps: true)
    }

    private func showStartupFailure(_ detail: String) {
        stopServer()

        let alert = NSAlert()
        alert.alertStyle = .critical
        alert.messageText = "LearnDeck could not start"
        alert.informativeText = "\(detail)\n\nServer log: \(logURL.path)"
        alert.addButton(withTitle: "Quit")
        alert.runModal()
        NSApp.terminate(nil)
    }

    private func stopServer() {
        guard let process = serverProcess else {
            cleanupServerFiles()
            return
        }

        let processID = process.processIdentifier
        if process.isRunning {
            if serverProcessGroupIsolated {
                _ = Darwin.kill(-processID, SIGTERM)
            }
            process.terminate()

            let deadline = Date().addingTimeInterval(2)
            while process.isRunning && Date() < deadline {
                usleep(50_000)
            }
            if process.isRunning {
                if serverProcessGroupIsolated {
                    _ = Darwin.kill(-processID, SIGKILL)
                }
                _ = Darwin.kill(processID, SIGKILL)
            }
        }
        process.waitUntilExit()
        serverProcess = nil
        serverProcessGroupIsolated = false

        try? serverLogHandle?.close()
        serverLogHandle = nil
        cleanupServerFiles()
    }

    private func cleanupServerFiles() {
        if let portFileURL {
            try? FileManager.default.removeItem(at: portFileURL)
        }
        if let pidFileURL {
            try? FileManager.default.removeItem(at: pidFileURL)
        }
        portFileURL = nil
        pidFileURL = nil
    }

    private nonisolated static func findFreePort() throws -> Int {
        let socketDescriptor = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard socketDescriptor >= 0 else {
            throw LaunchError.unableToFindPort
        }
        defer { Darwin.close(socketDescriptor) }

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = in_port_t(0).bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                Darwin.bind(socketDescriptor, socketAddress, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            throw LaunchError.unableToFindPort
        }

        var assignedAddress = sockaddr_in()
        var addressLength = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &assignedAddress) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { socketAddress in
                Darwin.getsockname(socketDescriptor, socketAddress, &addressLength)
            }
        }
        guard nameResult == 0 else {
            throw LaunchError.unableToFindPort
        }

        return Int(UInt16(bigEndian: assignedAddress.sin_port))
    }
}

@main
@MainActor
private struct LearnDeckApp {
    static func main() {
        let application = NSApplication.shared
        let delegate = LearnDeckAppDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.regular)
        application.run()
    }
}

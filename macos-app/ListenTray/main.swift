import AppKit
import Foundation

// The menu bar UI must live in the bundle's own CFBundleExecutable. A shell
// script that exec's Python leaves the process identity as org.python.python,
// which no longer matches the app LaunchServices registered, and macOS then
// silently declines to host the status item's scene (its window stays 0x0).

let appName = "TalkToMe"
let bundleId = "com.talktome.app"
/// Keep in sync with CFBundleShortVersionString in the build script.
let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String
    ?? "0.0.3"
let host = "127.0.0.1"
let port = 8765

func statusTitle(_ state: String) -> String {
    "\(appName) v\(appVersion): \(state)"
}

func loadBundledImage(name: String, size: NSSize? = nil) -> NSImage? {
    let candidates: [URL?] = [
        Bundle.main.url(forResource: name, withExtension: "png"),
        Bundle.main.resourceURL?.appendingPathComponent("\(name).png"),
        Bundle.main.resourceURL?.appendingPathComponent("Assets/\(name).png"),
    ]
    for case let url? in candidates {
        if let image = NSImage(contentsOf: url) {
            if let size {
                image.size = size
            }
            image.isTemplate = false
            return image
        }
    }
    return nil
}

let appSupport = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/TalkToMe")
let venvDir = appSupport.appendingPathComponent("venv")
let venvPython = venvDir.appendingPathComponent("bin/python")
let logDir = appSupport.appendingPathComponent("logs")
let serverLog = logDir.appendingPathComponent("server.log")
let installLog = logDir.appendingPathComponent("install.log")
let stampFile = appSupport.appendingPathComponent("install.stamp")
let pidFile = appSupport.appendingPathComponent("server.pid")
// Remember an explicit user choice so we don't re-prompt after they decide.
let loginPrefFile = appSupport.appendingPathComponent("open-at-login.pref")

let resources = Bundle.main.resourceURL!
let serverDir = resources.appendingPathComponent("server")
let requirements = resources.appendingPathComponent("requirements.txt")

let searchPath = "/usr/bin:/bin:/usr/sbin:/sbin:/usr/local/bin:/opt/homebrew/bin:/opt/local/bin"
let launchAgentLabel = bundleId
let launchAgentURL = FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/LaunchAgents/\(launchAgentLabel).plist")

// MARK: - Open at login (LaunchAgent)

func preferredAppURL() -> URL {
    if let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: bundleId) {
        return url
    }
    let applications = URL(fileURLWithPath: "/Applications/TalkToMe.app")
    if FileManager.default.fileExists(atPath: applications.path) {
        return applications
    }
    return Bundle.main.bundleURL
}

func isOpenAtLoginEnabled() -> Bool {
    FileManager.default.fileExists(atPath: launchAgentURL.path)
}

@discardableResult
func setOpenAtLogin(_ enabled: Bool) -> Bool {
    let fm = FileManager.default
    try? fm.createDirectory(at: appSupport, withIntermediateDirectories: true)
    try? (enabled ? "1" : "0").write(to: loginPrefFile, atomically: true, encoding: .utf8)

    if !enabled {
        try? fm.removeItem(at: launchAgentURL)
        let uid = getuid()
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        p.arguments = ["bootout", "gui/\(uid)/\(launchAgentLabel)"]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        try? p.run()
        p.waitUntilExit()
        // Also clear the old Listen TTS agent if present.
        let legacy = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/LaunchAgents/com.listen.tts.tray.plist")
        try? fm.removeItem(at: legacy)
        let legacyBoot = Process()
        legacyBoot.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        legacyBoot.arguments = ["bootout", "gui/\(uid)/com.listen.tts.tray"]
        legacyBoot.standardOutput = FileHandle.nullDevice
        legacyBoot.standardError = FileHandle.nullDevice
        try? legacyBoot.run()
        legacyBoot.waitUntilExit()
        return true
    }

    let appPath = preferredAppURL().path
    let plist = """
        <?xml version="1.0" encoding="UTF-8"?>
        <!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
        <plist version="1.0">
        <dict>
          <key>Label</key>
          <string>\(launchAgentLabel)</string>
          <key>ProgramArguments</key>
          <array>
            <string>/usr/bin/open</string>
            <string>-a</string>
            <string>\(appPath)</string>
          </array>
          <key>RunAtLoad</key>
          <true/>
        </dict>
        </plist>
        """
    do {
        try fm.createDirectory(
            at: launchAgentURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try plist.write(to: launchAgentURL, atomically: true, encoding: .utf8)
        let uid = getuid()
        let bootout = Process()
        bootout.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        bootout.arguments = ["bootout", "gui/\(uid)/\(launchAgentLabel)"]
        bootout.standardOutput = FileHandle.nullDevice
        bootout.standardError = FileHandle.nullDevice
        try? bootout.run()
        bootout.waitUntilExit()
        let bootstrap = Process()
        bootstrap.executableURL = URL(fileURLWithPath: "/bin/launchctl")
        bootstrap.arguments = ["bootstrap", "gui/\(uid)", launchAgentURL.path]
        bootstrap.standardOutput = FileHandle.nullDevice
        bootstrap.standardError = FileHandle.nullDevice
        try bootstrap.run()
        bootstrap.waitUntilExit()
        return bootstrap.terminationStatus == 0 || isOpenAtLoginEnabled()
    } catch {
        appendLog(installLog, "\n[tray] open-at-login failed: \(error)\n")
        return false
    }
}

// MARK: - Helpers

func ensureDirs() {
    try? FileManager.default.createDirectory(at: logDir, withIntermediateDirectories: true)
}

func appendLog(_ url: URL, _ text: String) {
    ensureDirs()
    guard let data = text.data(using: .utf8) else { return }
    if let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(data)
        try? handle.close()
    } else {
        try? data.write(to: url)
    }
}

func notify(_ message: String) {
    let escaped = message.replacingOccurrences(of: "\"", with: "\\\"")
    let script = "display notification \"\(escaped)\" with title \"\(appName)\""
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-e", script]
    try? p.run()
}

func alert(_ message: String) {
    let escaped = message.replacingOccurrences(of: "\"", with: "\\\"")
    let script = """
        display dialog "\(escaped)" buttons {"OK"} default button 1 \
        with icon caution with title "\(appName)"
        """
    let p = Process()
    p.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
    p.arguments = ["-e", script]
    try? p.run()
    p.waitUntilExit()
}

/// Runs a command to completion, appending stdout+stderr to `log`.
@discardableResult
func run(_ executable: URL, _ args: [String], cwd: URL? = nil, log: URL? = nil) throws -> Int32 {
    let p = Process()
    p.executableURL = executable
    p.arguments = args
    if let cwd { p.currentDirectoryURL = cwd }
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = searchPath
    p.environment = env

    if let log {
        ensureDirs()
        if !FileManager.default.fileExists(atPath: log.path) {
            FileManager.default.createFile(atPath: log.path, contents: nil)
        }
        let handle = try FileHandle(forWritingTo: log)
        handle.seekToEndOfFile()
        p.standardOutput = handle
        p.standardError = handle
    }
    try p.run()
    p.waitUntilExit()
    return p.terminationStatus
}

func capture(_ executable: URL, _ args: [String]) -> String? {
    let p = Process()
    p.executableURL = executable
    p.arguments = args
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = searchPath
    p.environment = env
    let pipe = Pipe()
    p.standardOutput = pipe
    p.standardError = FileHandle.nullDevice
    do { try p.run() } catch { return nil }
    let data = pipe.fileHandleForReading.readDataToEndOfFile()
    p.waitUntilExit()
    guard p.terminationStatus == 0 else { return nil }
    return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
}

/// First Python on the system that is 3.11 or newer.
func findPython() -> URL? {
    var candidates: [String] = []
    for name in ["python3.13", "python3.12", "python3.11", "python3.14", "python3"] {
        for dir in searchPath.split(separator: ":") {
            candidates.append("\(dir)/\(name)")
        }
    }
    if let versions = try? FileManager.default.contentsOfDirectory(
        atPath: "/Library/Frameworks/Python.framework/Versions") {
        for v in versions.sorted(by: >) {
            candidates.append("/Library/Frameworks/Python.framework/Versions/\(v)/bin/python3")
        }
    }

    for path in candidates where FileManager.default.isExecutableFile(atPath: path) {
        let probe = capture(
            URL(fileURLWithPath: path),
            ["-c", "import sys; print(sys.version_info[0] * 100 + sys.version_info[1])"])
        if let probe, let code = Int(probe), code >= 311 {
            return URL(fileURLWithPath: path)
        }
    }
    return nil
}

func healthOK(timeout: TimeInterval = 1.5) -> Bool {
    guard let url = URL(string: "http://\(host):\(port)/health") else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = timeout
    let semaphore = DispatchSemaphore(value: 0)
    var ok = false
    URLSession.shared.dataTask(with: request) { _, response, _ in
        ok = (response as? HTTPURLResponse)?.statusCode == 200
        semaphore.signal()
    }.resume()
    _ = semaphore.wait(timeout: .now() + timeout + 0.5)
    return ok
}

func readPid() -> Int32? {
    guard let text = try? String(contentsOf: pidFile, encoding: .utf8) else { return nil }
    return Int32(text.trimmingCharacters(in: .whitespacesAndNewlines))
}

func processAlive(_ pid: Int32?) -> Bool {
    guard let pid, pid > 0 else { return false }
    return kill(pid, 0) == 0
}

func depsInstalled() -> Bool {
    guard FileManager.default.isExecutableFile(atPath: venvPython.path) else { return false }
    guard let want = try? String(contentsOf: requirements, encoding: .utf8),
          let have = try? String(contentsOf: stampFile, encoding: .utf8) else { return false }
    return want == have
}

// MARK: - Server lifecycle

enum ServerError: Error {
    case noPython
    case installFailed(String)
}

var serverProcess: Process?

func installDependencies() throws {
    ensureDirs()
    guard let python = findPython() else { throw ServerError.noPython }

    if !FileManager.default.isExecutableFile(atPath: venvPython.path) {
        let code = try run(python, ["-m", "venv", venvDir.path], log: installLog)
        if code != 0 { throw ServerError.installFailed("venv creation failed (exit \(code))") }
    }
    var code = try run(venvPython, ["-m", "pip", "install", "-q", "-U", "pip"], log: installLog)
    if code != 0 { throw ServerError.installFailed("pip upgrade failed (exit \(code))") }

    code = try run(
        venvPython, ["-m", "pip", "install", "-q", "-r", requirements.path], log: installLog)
    if code != 0 { throw ServerError.installFailed("dependency install failed (exit \(code))") }

    if let text = try? String(contentsOf: requirements, encoding: .utf8) {
        try? text.write(to: stampFile, atomically: true, encoding: .utf8)
    }
}

func startServer() throws {
    if healthOK() || processAlive(readPid()) { return }
    ensureDirs()
    if !FileManager.default.fileExists(atPath: serverLog.path) {
        FileManager.default.createFile(atPath: serverLog.path, contents: nil)
    }
    let handle = try FileHandle(forWritingTo: serverLog)
    handle.seekToEndOfFile()

    let p = Process()
    p.executableURL = venvPython
    p.arguments = [
        "-m", "uvicorn", "app.main:app", "--host", host, "--port", String(port),
    ]
    p.currentDirectoryURL = serverDir
    var env = ProcessInfo.processInfo.environment
    env["PATH"] = searchPath
    // PYTHONPATH rather than `pip install -e`: the bundle is read-only, and
    // hatchling walks up into any enclosing git repo, which macOS TCC blocks.
    env["PYTHONPATH"] = serverDir.path
    // Keep bytecode out of the bundle. A __pycache__ directory written next to
    // the imported sources breaks the code signature's seal, after which macOS
    // refuses to launch the app at all: "TalkToMe is damaged".
    env["PYTHONPYCACHEPREFIX"] = appSupport.appendingPathComponent("pycache").path
    env["PYTHONDONTWRITEBYTECODE"] = "1"
    env["LISTEN_HOST"] = host
    env["LISTEN_PORT"] = String(port)
    p.environment = env
    p.standardOutput = handle
    p.standardError = handle
    try p.run()
    serverProcess = p
    try? String(p.processIdentifier).write(to: pidFile, atomically: true, encoding: .utf8)
}

func stopServer() {
    if let pid = readPid(), pid > 0 { kill(pid, SIGTERM) }
    serverProcess?.terminate()
    serverProcess = nil
    try? FileManager.default.removeItem(at: pidFile)
}

// MARK: - Menu bar

final class AppDelegate: NSObject, NSApplicationDelegate {
    private var statusItem: NSStatusItem!
    private var stateItem: NSMenuItem!
    private var openAtLoginItem: NSMenuItem!
    private var timer: Timer?
    private let monitorQueue = DispatchQueue(label: "talktome.monitor")
    private var busy = false
    private var state = "starting…" {
        didSet {
            let text = state
            DispatchQueue.main.async { [weak self] in
                self?.stateItem.title = statusTitle(text)
            }
        }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        if let image = loadBundledImage(name: "MenuBarIcon", size: NSSize(width: 18, height: 18))
            ?? loadBundledImage(name: "AppIcon", size: NSSize(width: 18, height: 18)) {
            statusItem.button?.image = image
            statusItem.button?.imagePosition = .imageOnly
        } else if let image = NSImage(
            systemSymbolName: "speaker.wave.2.fill", accessibilityDescription: appName) {
            image.isTemplate = true
            statusItem.button?.image = image
        } else {
            statusItem.button?.title = "Talk"
        }

        let menu = NSMenu()
        stateItem = NSMenuItem(title: statusTitle("starting…"), action: nil, keyEquivalent: "")
        stateItem.isEnabled = false
        menu.addItem(stateItem)
        menu.addItem(.separator())
        add(menu, "Install Browser Extension…", #selector(installExtension))
        openAtLoginItem = NSMenuItem(
            title: "Open at Login", action: #selector(toggleOpenAtLogin), keyEquivalent: "")
        openAtLoginItem.target = self
        openAtLoginItem.state = isOpenAtLoginEnabled() ? .on : .off
        menu.addItem(openAtLoginItem)
        menu.addItem(.separator())

        let advanced = NSMenu(title: "Advanced")
        add(advanced, "Open Health Check", #selector(openHealth))
        add(advanced, "Show Logs", #selector(showLogs))
        advanced.addItem(.separator())
        add(advanced, "Start Server", #selector(startServerAction))
        add(advanced, "Stop Server", #selector(stopServerAction))
        add(advanced, "Restart Server", #selector(restartServerAction))
        advanced.addItem(.separator())
        add(advanced, "Repair Install", #selector(repairAction))
        let advancedItem = NSMenuItem(title: "Advanced", action: nil, keyEquivalent: "")
        advancedItem.submenu = advanced
        menu.addItem(advancedItem)

        menu.addItem(.separator())
        add(menu, "Quit \(appName)", #selector(quitAction), key: "q")
        statusItem.menu = menu

        promptOpenAtLoginIfNeeded()

        timer = Timer.scheduledTimer(withTimeInterval: 2.5, repeats: true) { [weak self] _ in
            self?.poll()
        }
        bringUp(force: false)
    }

    /// First launch only: ask whether to start at login. Never auto-enables.
    private func promptOpenAtLoginIfNeeded() {
        if FileManager.default.fileExists(atPath: loginPrefFile.path) {
            openAtLoginItem.state = isOpenAtLoginEnabled() ? .on : .off
            return
        }
        let alert = NSAlert()
        alert.messageText = "Open \(appName) at login?"
        alert.informativeText =
            "Start \(appName) automatically when you log in so the menu bar icon is ready. "
            + "You can change this anytime from the menu."
        alert.addButton(withTitle: "Open at Login")
        alert.addButton(withTitle: "Not Now")
        let enable = alert.runModal() == .alertFirstButtonReturn
        _ = setOpenAtLogin(enable)
        openAtLoginItem.state = enable ? .on : .off
    }

    func applicationWillTerminate(_ notification: Notification) {
        stopServer()
    }

    private func add(_ menu: NSMenu, _ title: String, _ action: Selector, key: String = "") {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        menu.addItem(item)
    }

    private func poll() {
        guard !busy else { return }
        monitorQueue.async { [weak self] in
            guard let self, !self.busy else { return }
            if healthOK() {
                self.state = "running"
            } else if processAlive(readPid()) {
                self.state = "starting…"
            } else {
                self.state = "stopped"
            }
        }
    }

    private func bringUp(force: Bool) {
        monitorQueue.async { [weak self] in
            guard let self else { return }
            self.busy = true
            defer { self.busy = false }
            do {
                if force || !depsInstalled() {
                    self.state = "installing…"
                    notify("Installing dependencies, this takes a minute…")
                    try installDependencies()
                }
                self.state = "starting…"
                try startServer()
                for _ in 0..<60 {
                    if healthOK() {
                        self.state = "running"
                        return
                    }
                    Thread.sleep(forTimeInterval: 0.5)
                }
                self.state = "failed to start — see logs"
                notify("The server did not start. Check Show Logs.")
            } catch ServerError.noPython {
                self.state = "Python 3.11+ required"
                alert(
                    "\(appName) needs Python 3.11 or newer.\n\n"
                        + "Install it from python.org/downloads, then choose Repair Install "
                        + "from the menu bar.")
            } catch let ServerError.installFailed(reason) {
                self.state = "install failed — see logs"
                appendLog(installLog, "\n[tray] \(reason)\n")
                notify("Install failed: \(reason)")
            } catch {
                self.state = "error — see logs"
                appendLog(installLog, "\n[tray] \(error)\n")
            }
        }
    }

    // MARK: Actions

    @objc private func installExtension() {
        let extensionDir = resources.appendingPathComponent("extension")
        NSWorkspace.shared.selectFile(
            extensionDir.path, inFileViewerRootedAtPath: resources.path)
        alert(
            "Chrome will ask for a folder.\n\n"
                + "1. Go to chrome://extensions\n"
                + "2. Turn on Developer mode\n"
                + "3. Click \"Load unpacked\"\n"
                + "4. Choose the \"extension\" folder now open in Finder")
    }

    @objc private func openHealth() {
        if let url = URL(string: "http://\(host):\(port)/health") {
            NSWorkspace.shared.open(url)
        }
    }

    @objc private func showLogs() {
        ensureDirs()
        NSWorkspace.shared.open(logDir)
    }

    @objc private func startServerAction() {
        bringUp(force: false)
    }

    @objc private func stopServerAction() {
        monitorQueue.async { [weak self] in
            stopServer()
            self?.state = "stopped"
        }
    }

    @objc private func restartServerAction() {
        monitorQueue.async { [weak self] in
            stopServer()
            Thread.sleep(forTimeInterval: 0.5)
            self?.bringUp(force: false)
        }
    }

    @objc private func repairAction() {
        monitorQueue.async { [weak self] in
            stopServer()
            try? FileManager.default.removeItem(at: stampFile)
            self?.bringUp(force: true)
        }
    }

    @objc private func toggleOpenAtLogin() {
        let enable = openAtLoginItem.state != .on
        if setOpenAtLogin(enable) {
            openAtLoginItem.state = enable ? .on : .off
        } else {
            notify("Couldn’t update Open at Login — see Show Logs.")
        }
    }

    @objc private func quitAction() {
        stopServer()
        NSApplication.shared.terminate(nil)
    }
}

// MARK: - Entry point

let runningCount = NSRunningApplication.runningApplications(
    withBundleIdentifier: Bundle.main.bundleIdentifier ?? bundleId
).count
if runningCount > 1 {
    notify("\(appName) is already running.")
    exit(0)
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.accessory)
app.run()

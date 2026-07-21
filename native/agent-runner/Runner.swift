import Darwin
import Foundation

struct RunnerRequest: Codable {
    let script: String
    let cwd: String
    let environment: [String: String]
    let timeoutMs: Int
    let sandboxBookmark: String
    let readOnlyBookmarks: [String]
}

struct RunnerResponse: Codable {
    let exitCode: Int?
    let signal: String?
    let stdout: String
    let stderr: String
    let durationMs: Int
    let timedOut: Bool
    let truncated: Bool
}

let outputLimit = 256 * 1024

final class LimitedDataCollector {
    private let lock = NSLock()
    private var data = Data()
    private(set) var truncated = false

    func append(_ chunk: Data) {
        guard !chunk.isEmpty else { return }
        lock.lock()
        defer { lock.unlock() }
        let remaining = max(0, outputLimit - data.count)
        if chunk.count > remaining { truncated = true }
        if remaining > 0 { data.append(chunk.prefix(remaining)) }
    }

    func string() -> String {
        lock.lock()
        defer { lock.unlock() }
        return String(data: data, encoding: .utf8) ?? ""
    }
}

func resolveBookmark(_ encoded: String) throws -> URL {
    guard let data = Data(base64Encoded: encoded) else {
        throw NSError(domain: "ReforaAgentRunner", code: 1, userInfo: [NSLocalizedDescriptionKey: "Invalid bookmark"])
    }
    var stale = false
    return try URL(
        resolvingBookmarkData: data,
        options: [],
        relativeTo: nil,
        bookmarkDataIsStale: &stale
    )
}

func writeResponse(_ response: RunnerResponse) {
    let data = try! JSONEncoder().encode(response)
    FileHandle.standardOutput.write(data)
}

func sandboxLiteral(_ value: String) -> String {
    return value
        .replacingOccurrences(of: "\\", with: "\\\\")
        .replacingOccurrences(of: "\"", with: "\\\"")
        .replacingOccurrences(of: "\n", with: "\\n")
        .replacingOccurrences(of: "\r", with: "\\r")
}

func sandboxProfile(sandboxRoot: String, readOnlyPaths: [String]) -> String {
    var rules = [
        "(version 1)",
        "(deny default)",
        "(allow process*)",
        "(allow sysctl-read)",
        "(allow file-read*)",
        "(deny file-read* (subpath \"/Users\") (subpath \"/Volumes\") (subpath \"/private/tmp\") (subpath \"/private/var/folders\") (subpath \"/Network\"))",
        "(allow file-read* (subpath \"\(sandboxLiteral(sandboxRoot))\"))",
        "(allow file-write* (subpath \"\(sandboxLiteral(sandboxRoot))\") (literal \"/dev/null\"))"
    ]
    for path in readOnlyPaths {
        rules.append("(allow file-read* (subpath \"\(sandboxLiteral(path))\"))")
    }
    return rules.joined(separator: " ")
}

let startedAt = Date()
let input = FileHandle.standardInput.readDataToEndOfFile()
guard let request = try? JSONDecoder().decode(RunnerRequest.self, from: input) else {
    writeResponse(RunnerResponse(exitCode: nil, signal: nil, stdout: "", stderr: "Invalid runner request", durationMs: 0, timedOut: false, truncated: false))
    exit(1)
}

do {
    let sandboxURL = try resolveBookmark(request.sandboxBookmark)
    let readOnlyURLs = try request.readOnlyBookmarks.map(resolveBookmark)
    let sandboxAccess = sandboxURL.startAccessingSecurityScopedResource()
    let activeReadOnlyURLs = readOnlyURLs.filter { $0.startAccessingSecurityScopedResource() }
    let profileURL = sandboxURL.appendingPathComponent("tmp", isDirectory: true)
        .appendingPathComponent("sandbox-\(UUID().uuidString).sb")
    try sandboxProfile(
        sandboxRoot: sandboxURL.path,
        readOnlyPaths: readOnlyURLs.map(\.path)
    ).write(to: profileURL, atomically: true, encoding: .utf8)
    defer {
        try? FileManager.default.removeItem(at: profileURL)
        if sandboxAccess { sandboxURL.stopAccessingSecurityScopedResource() }
        activeReadOnlyURLs.forEach { $0.stopAccessingSecurityScopedResource() }
    }
    let process = Process()
    let output = Pipe()
    let errors = Pipe()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/sandbox-exec")
    process.arguments = [
        "-f",
        profileURL.path,
        "/bin/bash",
        "--noprofile",
        "--norc",
        "-o",
        "pipefail",
        "-c",
        request.script
    ]
    process.currentDirectoryURL = URL(fileURLWithPath: request.cwd)
    process.environment = request.environment
    process.standardInput = FileHandle.nullDevice
    process.standardOutput = output
    process.standardError = errors
    let stdoutCollector = LimitedDataCollector()
    let stderrCollector = LimitedDataCollector()
    output.fileHandleForReading.readabilityHandler = { handle in
        stdoutCollector.append(handle.availableData)
    }
    errors.fileHandleForReading.readabilityHandler = { handle in
        stderrCollector.append(handle.availableData)
    }
    let semaphore = DispatchSemaphore(value: 0)
    process.terminationHandler = { _ in semaphore.signal() }
    try process.run()
    let deadline = DispatchTime.now() + .milliseconds(request.timeoutMs)
    let timedOut = semaphore.wait(timeout: deadline) == .timedOut
    if timedOut {
        process.terminate()
        if semaphore.wait(timeout: .now() + .seconds(1)) == .timedOut {
            kill(process.processIdentifier, SIGKILL)
            semaphore.wait()
        }
    }
    output.fileHandleForReading.readabilityHandler = nil
    errors.fileHandleForReading.readabilityHandler = nil
    stdoutCollector.append(output.fileHandleForReading.readDataToEndOfFile())
    stderrCollector.append(errors.fileHandleForReading.readDataToEndOfFile())
    writeResponse(RunnerResponse(
        exitCode: Int(process.terminationStatus),
        signal: process.terminationReason == .uncaughtSignal ? "SIGNALED" : nil,
        stdout: stdoutCollector.string(),
        stderr: stderrCollector.string(),
        durationMs: Int(Date().timeIntervalSince(startedAt) * 1000),
        timedOut: timedOut,
        truncated: stdoutCollector.truncated || stderrCollector.truncated
    ))
} catch {
    writeResponse(RunnerResponse(
        exitCode: nil,
        signal: nil,
        stdout: "",
        stderr: error.localizedDescription,
        durationMs: Int(Date().timeIntervalSince(startedAt) * 1000),
        timedOut: false,
        truncated: false
    ))
    exit(1)
}

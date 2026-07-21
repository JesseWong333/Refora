import Foundation

struct BrokerRequest: Codable {
    let script: String
    let cwd: String
    let environment: [String: String]
    let timeoutMs: Int
    let sandboxRoot: String
    let readOnlyPaths: [String]
}

struct RunnerRequest: Codable {
    let script: String
    let cwd: String
    let environment: [String: String]
    let timeoutMs: Int
    let sandboxBookmark: String
    let readOnlyBookmarks: [String]
}

struct BrokerError: Codable {
    let exitCode: Int?
    let signal: String?
    let stdout: String
    let stderr: String
    let durationMs: Int
    let timedOut: Bool
    let truncated: Bool
}

final class PipeCollector {
    private let lock = NSLock()
    private var collected = Data()

    func append(_ chunk: Data) {
        guard !chunk.isEmpty else { return }
        lock.lock()
        collected.append(chunk)
        lock.unlock()
    }

    func data() -> Data {
        lock.lock()
        defer { lock.unlock() }
        return collected
    }
}

func bookmark(path: String) throws -> String {
    let url = URL(fileURLWithPath: path)
    let data = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
    return data.base64EncodedString()
}

func fail(_ message: String) -> Never {
    let response = BrokerError(
        exitCode: nil,
        signal: nil,
        stdout: "",
        stderr: message,
        durationMs: 0,
        timedOut: false,
        truncated: false
    )
    let data = try! JSONEncoder().encode(response)
    FileHandle.standardOutput.write(data)
    exit(1)
}

let input = FileHandle.standardInput.readDataToEndOfFile()
guard let request = try? JSONDecoder().decode(BrokerRequest.self, from: input) else {
    fail("Invalid broker request")
}

do {
    let executable = URL(fileURLWithPath: CommandLine.arguments[0]).deletingLastPathComponent()
        .appendingPathComponent("ReforaAgentRunner.app/Contents/MacOS/ReforaAgentRunner").path
    let runnerRequest = RunnerRequest(
        script: request.script,
        cwd: request.cwd,
        environment: request.environment,
        timeoutMs: request.timeoutMs,
        sandboxBookmark: try bookmark(path: request.sandboxRoot),
        readOnlyBookmarks: try request.readOnlyPaths.map { try bookmark(path: $0) }
    )
    let process = Process()
    let output = Pipe()
    let errors = Pipe()
    process.executableURL = URL(fileURLWithPath: executable)
    process.standardInput = Pipe()
    process.standardOutput = output
    process.standardError = errors
    let outputCollector = PipeCollector()
    let errorCollector = PipeCollector()
    output.fileHandleForReading.readabilityHandler = { handle in
        outputCollector.append(handle.availableData)
    }
    errors.fileHandleForReading.readabilityHandler = { handle in
        errorCollector.append(handle.availableData)
    }
    try process.run()
    if let pipe = process.standardInput as? Pipe {
        pipe.fileHandleForWriting.write(try JSONEncoder().encode(runnerRequest))
        try pipe.fileHandleForWriting.close()
    }
    process.waitUntilExit()
    output.fileHandleForReading.readabilityHandler = nil
    errors.fileHandleForReading.readabilityHandler = nil
    outputCollector.append(output.fileHandleForReading.readDataToEndOfFile())
    errorCollector.append(errors.fileHandleForReading.readDataToEndOfFile())
    let result = outputCollector.data()
    let errorData = errorCollector.data()
    if process.terminationStatus != 0 && result.isEmpty {
        fail(String(data: errorData, encoding: .utf8) ?? "Runner failed")
    }
    FileHandle.standardOutput.write(result)
    exit(process.terminationStatus)
} catch {
    fail(error.localizedDescription)
}

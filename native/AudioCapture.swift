import Foundation
import ScreenCaptureKit
import AVFoundation
import CoreMedia

func emit(_ value: [String: Any]) {
    if let bytes = try? JSONSerialization.data(withJSONObject: value), let text = String(data: bytes, encoding: .utf8) { print(text); fflush(stdout) }
}
final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    let queue = DispatchQueue(label: "jianpu.audio.capture")
    let writer: AVAssetWriter
    let input: AVAssetWriterInput
    var started = false
    var samples = 0
    var failure: String?
    init(path: String) throws {
        writer = try AVAssetWriter(outputURL: URL(fileURLWithPath: path), fileType: .m4a)
        input = AVAssetWriterInput(mediaType: .audio, outputSettings: [AVFormatIDKey: kAudioFormatMPEG4AAC, AVSampleRateKey: 48000, AVNumberOfChannelsKey: 2, AVEncoderBitRateKey: 192000])
        input.expectsMediaDataInRealTime = true
        super.init()
        guard writer.canAdd(input) else { throw NSError(domain: "capture", code: 1, userInfo: [NSLocalizedDescriptionKey: "无法创建音频编码器"]) }
        writer.add(input)
    }
    func stream(_ stream: SCStream, didOutputSampleBuffer buffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, buffer.isValid, CMSampleBufferDataIsReady(buffer) else { return }
        if !started {
            guard writer.startWriting() else { failure = writer.error?.localizedDescription; return }
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(buffer)); started = true
        }
        if input.isReadyForMoreMediaData {
            if input.append(buffer) { samples += CMSampleBufferGetNumSamples(buffer) }
            else { failure = writer.error?.localizedDescription ?? "写入音频失败" }
        } else { failure = "音频编码器来不及写入，请停止其他高负载任务后重录" }
    }
    func stream(_ stream: SCStream, didStopWithError error: Error) { failure = error.localizedDescription; emit(["event":"error", "message":error.localizedDescription]) }
    func finish() async throws -> Int {
        await withCheckedContinuation { continuation in queue.async { self.input.markAsFinished(); continuation.resume() } }
        guard started else { throw NSError(domain:"capture",code:2,userInfo:[NSLocalizedDescriptionKey:"没有采集到音频，请确认目标App正在播放且系统权限已允许"]) }
        await withCheckedContinuation { continuation in writer.finishWriting { continuation.resume() } }
        if let failure = failure { throw NSError(domain:"capture",code:3,userInfo:[NSLocalizedDescriptionKey:failure]) }
        guard writer.status == .completed else { throw writer.error ?? NSError(domain:"capture",code:4) }
        return samples
    }
}
@main struct AudioCapture {
    static func main() async {
        do {
            let args = CommandLine.arguments
            let content = try await SCShareableContent.excludingDesktopWindows(true, onScreenWindowsOnly: false)
            if args.count == 2 && args[1] == "list" {
                var seen = Set<String>()
                let apps = content.applications.filter { !$0.bundleIdentifier.isEmpty && seen.insert($0.bundleIdentifier).inserted }.map { ["name":$0.applicationName,"bundleId":$0.bundleIdentifier] }.sorted { $0["name"]! < $1["name"]! }
                emit(["apps":apps]); return
            }
            guard args.count == 4, args[1] == "record", let app = content.applications.first(where: { $0.bundleIdentifier == args[2] }), let display = content.displays.first else { throw NSError(domain:"capture",code:5,userInfo:[NSLocalizedDescriptionKey:"目标App未运行，或未授权屏幕与系统音频录制"]) }
            let recorder = try Recorder(path: args[3])
            let filter = SCContentFilter(display: display, including: [app], exceptingWindows: [])
            let config = SCStreamConfiguration()
            config.width = 2; config.height = 2; config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
            config.capturesAudio = true; config.excludesCurrentProcessAudio = true; config.sampleRate = 48000; config.channelCount = 2
            let stream = SCStream(filter: filter, configuration: config, delegate: recorder)
            try stream.addStreamOutput(recorder, type: .audio, sampleHandlerQueue: recorder.queue)
            try await stream.startCapture(); emit(["event":"recording"])
            await withCheckedContinuation { continuation in DispatchQueue.global().async { _ = readLine(); continuation.resume() } }
            try await stream.stopCapture()
            let count = try await recorder.finish(); emit(["event":"done","samples":count])
        } catch { emit(["event":"error","message":error.localizedDescription]); exit(1) }
    }
}

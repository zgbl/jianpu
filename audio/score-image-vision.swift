import ImageIO
import Vision
import Foundation

let path = CommandLine.arguments[1]
guard let source = CGImageSourceCreateWithURL(URL(fileURLWithPath: path) as CFURL, nil),
      let cg = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
    fputs("Cannot decode image", stderr); exit(2)
}
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = false
request.recognitionLanguages = ["zh-Hans", "en-US"]
request.minimumTextHeight = 0.004
do {
    try VNImageRequestHandler(cgImage: cg, options: [:]).perform([request])
} catch {
    fputs("Vision OCR error: \(String(reflecting: error))", stderr)
    exit(3)
}
let results = (request.results ?? []).compactMap { item -> [String: Any]? in
    guard let candidate = item.topCandidates(1).first else { return nil }
    // Vision's line rectangle is not a usable position for individual notes:
    // the spaces between printed notes are not equal. Keep the real character boxes.
    var glyphs: [[String: Any]] = []
    var index = candidate.string.startIndex
    let count = max(1, candidate.string.count)
    var position = 0
    while index < candidate.string.endIndex {
        let next = candidate.string.index(after: index)
        if let box = try? candidate.boundingBox(for: index..<next) {
            glyphs.append(["text": String(candidate.string[index..<next]),
                           "box": [box.boundingBox.minX, box.boundingBox.minY,
                                   box.boundingBox.width, box.boundingBox.height]])
        } else if !candidate.string[index].isWhitespace {
            // A partial Vision character-box failure must not silently drop a
            // note. Keep it visible for the beat-count audit and manual review.
            glyphs.append(["text": String(candidate.string[index..<next]),
                           "box": [item.boundingBox.minX + item.boundingBox.width * Double(position) / Double(count),
                                   item.boundingBox.minY,
                                   item.boundingBox.width / Double(count),
                                   item.boundingBox.height]])
        }
        index = next
        position += 1
    }
    return ["text": candidate.string,
            "confidence": candidate.confidence,
            "box": [item.boundingBox.minX, item.boundingBox.minY,
                    item.boundingBox.width, item.boundingBox.height],
            "glyphs": glyphs]
}
// Chord labels above guitar diagrams are only about 15 pixels tall in a whole
// page. Vision routinely omits them in the full-page pass. Locate the six
// long TAB staff rules, then the vertical strings of each diagram above that
// staff, and OCR only the small printed label above each diagram.
let width = cg.width, height = cg.height
var rgba = [UInt8](repeating: 255, count: width * height * 4)
rgba.withUnsafeMutableBytes { bytes in
    let space = CGColorSpaceCreateDeviceRGB()
    if let context = CGContext(data: bytes.baseAddress, width: width, height: height,
                               bitsPerComponent: 8, bytesPerRow: width * 4,
                               space: space, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue) {
        context.draw(cg, in: CGRect(x: 0, y: 0, width: width, height: height))
    }
}
func dark(_ x: Int, _ y: Int) -> Bool {
    if x < 0 || y < 0 || x >= width || y >= height { return false }
    let i = (y * width + x) * 4
    return rgba[i] < 185 && rgba[i + 1] < 185 && rgba[i + 2] < 185
}
func longestHorizontal(_ y: Int) -> Int {
    var run = 0, best = 0
    for x in 0..<width { if dark(x, y) { run += 1; best = max(best, run) } else { run = 0 } }
    return best
}
let rulePixels = (0..<height).filter { longestHorizontal($0) > width / 2 }
var rules: [Int] = []
for y in rulePixels { if rules.last.map({ y - $0 > 3 }) ?? true { rules.append(y) } }
var staffGroups: [[Int]] = []
for y in rules {
    if staffGroups.last.map({ y - ($0.last ?? y) < max(35, width / 40) }) ?? false {
        staffGroups[staffGroups.count - 1].append(y)
    } else { staffGroups.append([y]) }
}
var chords: [[String: Any]] = []
var melodyObservations: [[String: Any]] = []
var lyricObservations: [[String: Any]] = []
for (systemIndex, group) in staffGroups.enumerated() where group.count >= 5 {
    let top = group[0]
    let gaps = zip(group, group.dropFirst()).map { $1 - $0 }.sorted()
    let step = gaps[gaps.count / 2]
    guard step >= 8 && step <= 50 else { continue }
    // Read the Jianpu strip on its own. The Chinese/full-page pass can lose
    // notes beneath a watermark or merge several symbols into one word.
    let melodyY = top + step * 10
    let melodyHeight = min(height - melodyY, step * 5)
    let melodyX = max(0, step * 4)
    if melodyHeight > 0, let strip = cg.cropping(to: CGRect(x: melodyX, y: melodyY, width: width - melodyX, height: melodyHeight)) {
        let melodyRequest = VNRecognizeTextRequest()
        melodyRequest.recognitionLevel = .accurate
        melodyRequest.usesLanguageCorrection = false
        melodyRequest.recognitionLanguages = ["en-US"]
        if (try? VNImageRequestHandler(cgImage: strip, options: [:]).perform([melodyRequest])) != nil {
            let cropWidth = Double(width - melodyX), cropHeight = Double(melodyHeight)
            func globalBox(_ box: CGRect) -> [Double] {
                [ (Double(melodyX) + box.minX * cropWidth) / Double(width),
                  (Double(height - melodyY - melodyHeight) + box.minY * cropHeight) / Double(height),
                  box.width * cropWidth / Double(width), box.height * cropHeight / Double(height) ]
            }
            for item in melodyRequest.results ?? [] {
                guard let candidate = item.topCandidates(1).first else { continue }
                let centerY = Double(melodyY) + (1 - item.boundingBox.midY) * Double(melodyHeight)
                if centerY > Double(melodyY) + Double(step) * 3.7 { continue }
                var glyphs: [[String: Any]] = []
                var index = candidate.string.startIndex
                while index < candidate.string.endIndex {
                    let next = candidate.string.index(after: index)
                    if let box = try? candidate.boundingBox(for: index..<next) {
                        glyphs.append(["text": String(candidate.string[index..<next]), "box": globalBox(box.boundingBox)])
                    }
                    index = next
                }
                melodyObservations.append(["text": candidate.string, "systemIndex": systemIndex,
                                           "confidence": candidate.confidence,
                                           "box": globalBox(item.boundingBox), "glyphs": glyphs])
            }
        }
    }
    // Whole-page OCR often skips a few Chinese characters under a melody,
    // especially across a pale watermark. Read the lyric band separately.
    let lyricY = melodyY + step * 4
    let lyricHeight = min(height - lyricY, step * 3)
    if lyricHeight > 0,
       let strip = cg.cropping(to: CGRect(x: melodyX, y: lyricY, width: width - melodyX, height: lyricHeight)) {
        let lyricRequest = VNRecognizeTextRequest()
        lyricRequest.recognitionLevel = .accurate
        lyricRequest.usesLanguageCorrection = false
        lyricRequest.recognitionLanguages = ["zh-Hans"]
        if (try? VNImageRequestHandler(cgImage: strip, options: [:]).perform([lyricRequest])) != nil {
            let cropWidth = Double(width - melodyX), cropHeight = Double(lyricHeight)
            func globalBox(_ box: CGRect) -> [Double] {
                [ (Double(melodyX) + box.minX * cropWidth) / Double(width),
                  (Double(height - lyricY - lyricHeight) + box.minY * cropHeight) / Double(height),
                  box.width * cropWidth / Double(width), box.height * cropHeight / Double(height) ]
            }
            for item in lyricRequest.results ?? [] {
                guard let candidate = item.topCandidates(1).first,
                      candidate.string.unicodeScalars.contains(where: { (0x3400...0x9fff).contains($0.value) }) else { continue }
                var glyphs: [[String: Any]] = []
                var index = candidate.string.startIndex
                while index < candidate.string.endIndex {
                    let next = candidate.string.index(after: index)
                    if let box = try? candidate.boundingBox(for: index..<next) {
                        glyphs.append(["text": String(candidate.string[index..<next]), "box": globalBox(box.boundingBox)])
                    }
                    index = next
                }
                lyricObservations.append(["text": candidate.string, "systemIndex": systemIndex,
                                          "confidence": candidate.confidence,
                                          "box": globalBox(item.boundingBox), "glyphs": glyphs])
            }
        }
    }
    let zoneTop = max(0, top - step * 4), zoneBottom = max(0, top - step)
    var stringXs: [Int] = []
    for x in 0..<width {
        var run = 0, best = 0
        if zoneTop < zoneBottom { for y in zoneTop..<zoneBottom {
            if dark(x, y) { run += 1; best = max(best, run) } else { run = 0 }
        }}
        if best >= max(24, (zoneBottom - zoneTop) / 2) { stringXs.append(x) }
    }
    var diagramGroups: [[Int]] = []
    for x in stringXs {
        if diagramGroups.last.map({ x - ($0.last ?? x) <= max(10, step) }) ?? false {
            diagramGroups[diagramGroups.count - 1].append(x)
        } else { diagramGroups.append([x]) }
    }
    for xs in diagramGroups where xs.count >= 4 && xs.last! - xs[0] >= step * 2 && xs.last! - xs[0] <= step * 6 {
        let center = (xs[0] + xs.last!) / 2
        let cropWidth = max(38, Int(Double(step) * 2.7))
        let cropHeight = max(22, Int(Double(step) * 1.45))
        let cropY = top < step * 6 ? 0 : max(0, top - Int(Double(step) * 5.55))
        var recognized: String? = nil
        for offset in [0, -step, step] {
            let cropX = max(0, min(width - cropWidth, center + offset - cropWidth / 2))
            guard cropY + cropHeight <= height,
                  let crop = cg.cropping(to: CGRect(x: cropX, y: cropY, width: cropWidth, height: cropHeight)) else { continue }
            let chordRequest = VNRecognizeTextRequest()
            chordRequest.recognitionLevel = .accurate
            chordRequest.usesLanguageCorrection = false
            chordRequest.recognitionLanguages = ["en-US"]
            do { try VNImageRequestHandler(cgImage: crop, options: [:]).perform([chordRequest]) } catch { continue }
            for item in chordRequest.results ?? [] {
                guard let label = item.topCandidates(1).first?.string.trimmingCharacters(in: .whitespacesAndNewlines) else { continue }
                if label.range(of: "^[A-G](?:#|b)?(?:(?:maj|min|dim|aug|sus|add|m)[0-9]*)?(?:/[A-G](?:#|b)?)?$", options: .regularExpression) != nil {
                    recognized = label; break
                }
            }
            if recognized != nil { break }
        }
        if let label = recognized {
            chords.append(["text": label, "x": Double(center) / Double(width),
                           "y": Double(cropY + cropHeight / 2) / Double(height)])
        }
    }
}
let data = try JSONSerialization.data(withJSONObject: ["width": width, "height": height, "observations": results, "melodyObservations": melodyObservations, "lyricObservations": lyricObservations, "chords": chords], options: [.sortedKeys])
FileHandle.standardOutput.write(data)

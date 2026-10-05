"""Browser verification with deterministic audio evidence, optionally an existing project (read-only)."""
import argparse, json, math, wave, io, struct, mimetypes
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright
parser=argparse.ArgumentParser();parser.add_argument('--project');args=parser.parse_args()
root=Path(__file__).resolve().parents[1]
project_id=args.project or 'test-debug';run_id='00000000-0000-4000-8000-000000000001'
b=io.BytesIO()
with wave.open(b,'wb') as wav:
    wav.setnchannels(1);wav.setsampwidth(2);wav.setframerate(16000)
    wav.writeframes(b''.join(struct.pack('<h',round(12000*math.sin(2*math.pi*440*i/16000))) for i in range(96000)))
audio=b.getvalue()
frames=[dict(time=i*.016,midi=69+.12*math.sin(i/4),voiced=i%25!=0,energy=.2,voicingProbability=.9,cleanedMidi=69) for i in range(375)]
notes=[dict(start=i+.2,end=i+.8,midi=69,coreStart=i+.3,coreEnd=i+.7,pitchCenterMidi=69.02,voicingProbability=.9) for i in range(5)]
meta=dict(clipStart=30,sampleRate=16000,frameLength=1024,hopLength=256,detector='librosa.pyin')
fixtures={'pitch-observations.json':dict(metadata=meta,frames=frames),'melody-candidates-v3.json':dict(metadata=meta,notes=notes,diagnostics={'tuningCents':2}),'result.json':dict(duration=6,clipStart=30,notes=notes)}
if args.project:
    project=json.loads((root/'.projects'/project_id/'project.json').read_text())
else:
    project=dict(id=project_id,name='调试验证',revision=1,updatedAt='2026-10-04',runs=[dict(id=run_id,status='done',startedAt=1780000000000,params={'start':30})],activeRunId=run_id,scoreBasedOn=run_id,score={'measures':[]},workspace={'stage':'transcribe'},assets=[{'path':f'runs/{run_id}/{f}'} for f in [*fixtures,'clip.wav','vocals.wav']])
if not args.project:
    score=dict(format='jianpu-melody',version=2,title='调试验证',key='A',meter=[4,4],lyrics=[dict(noteId='s0',verse=1,text='啊')],spans=[],transcription={'clipStart':30,'bpm':120},measures=[dict(id='m0',notes=[dict(id='s'+str(i),degree=1,octave=0,base=8,dots=0,sourceTime=i+.2,sourceEnd=i+.8,gridTimeStart=i+.2,gridTimeEnd=i+.8) for i in range(5)])])
    project['score']=score
    fixtures['recognized.jpu']=json.loads(json.dumps(score))
    fixtures['recognized.jpu']['key']='G'
    project['assets'].append({'path':f'runs/{run_id}/recognized.jpu'})
errors=[];writes=[]
with sync_playwright() as p:
    browser=p.chromium.launch(headless=True,executable_path='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')
    context=browser.new_context(viewport={'width':1440,'height':1000},device_scale_factor=2)
    def route(req):
        url=urlparse(req.request.url);q=parse_qs(url.query);path=url.path
        if req.request.method not in ['GET','HEAD']: writes.append(path)
        if path.startswith('/api/projects'):
            if path.endswith('/asset'):
                f=q['path'][0]
                if args.project:
                    body=(root/'.projects'/project_id/f).read_bytes()
                else:
                    name=Path(f).name;body=audio if name.endswith('.wav') else json.dumps(fixtures[name]).encode()
                if f.endswith('.wav'):
                    headers={'Accept-Ranges':'bytes'}
                    ranged=req.request.headers.get('range','')
                    if ranged.startswith('bytes='):
                        lo,hi=ranged[6:].split('-',1);lo=int(lo or 0);hi=min(int(hi) if hi else len(body)-1,len(body)-1)
                        headers['Content-Range']=f'bytes {lo}-{hi}/{len(body)}'
                        return req.fulfill(status=206,body=body[lo:hi+1],headers=headers,content_type='audio/wav')
                    return req.fulfill(body=body,headers=headers,content_type='audio/wav')
                return req.fulfill(body=body,content_type='application/json')
            return req.fulfill(json=project)
        if path.startswith('/api/'):return req.fulfill(json={})
        if path in ['/transcribe.html','/score-image.html','/model-score.html','/compare.html']:
            return req.fulfill(body='<script>parent.postMessage({type:"workspace:ready"},location.origin)</script>',content_type='text/html')
        file=root/('index.html' if path=='/' else path.lstrip('/'))
        if not file.is_file():return req.fulfill(status=404,body='Not found')
        return req.fulfill(body=file.read_bytes(),content_type={'.js':'text/javascript','.css':'text/css','.html':'text/html'}.get(file.suffix,'application/octet-stream'))
    context.route('**/*',route)
    page=context.new_page();page.on('pageerror',lambda e:errors.append(str(e)))
    page.goto('http://jianpu-test.local/audio-debug.html?project='+project_id)
    page.wait_for_function("document.getElementById('status').textContent.startsWith('已加载')",timeout=120000)
    assert page.locator('#scoreStrip').is_visible()
    if not args.project:
        assert '1=A' in page.locator('#scoreInfo').inner_text()
        page.locator('#scoreSource').select_option('recognized');assert '1=G' in page.locator('#scoreInfo').inner_text()
        page.locator('#scoreSource').select_option('current')
        page.locator('#scoreStrip').scroll_into_view_if_needed();page.wait_for_timeout(150)
        box=page.locator('#scoreStrip').bounding_box()
        # Click at 30.3 original seconds in initial 30–36 window, selecting the first glyph.
        px=box['x']+76+.3/6*(box['width']-76-64)
        page.mouse.click(px,box['y']+65)
        assert page.locator('#note').input_value()=='0'
        assert abs(float(page.locator('#start').input_value())-30.2)<.001
        page.wait_for_timeout(300)
        assert page.locator('#scoreStrip').get_attribute('data-active-note')=='s0',page.evaluate("({time:document.getElementById('audio').currentTime,active:document.getElementById('scoreStrip').dataset.activeNote,readout:document.getElementById('scoreReadout').textContent,errors:"+json.dumps(errors)+"})")
        assert '啊' in page.locator('#scoreReadout').inner_text()
        page.evaluate("async()=>{const a=document.getElementById('audio');a.currentTime=1.3;await a.play()}")
        page.wait_for_function("document.getElementById('scoreStrip').dataset.activeNote==='s1'")
        page.locator('#stop').click()
        edited=json.loads(json.dumps(project));edited['score']['measures'][0]['notes'][1]['degree']=3
        page.evaluate("p=>window.dispatchEvent(new CustomEvent('project-restore',{detail:{project:p}}))",edited)
        page.wait_for_function("document.getElementById('scoreReadout').textContent.includes('第 1 小节 · 3 ·')")
    page.locator('#note').select_option('0');assert 'MIDI' in page.locator('#noteInfo').inner_text()
    start=float(page.locator('#start').input_value());assert start>=0
    if not args.project: assert abs(start-30.2)<.001
    page.locator('#selectCore').click() if page.locator('#selectCore').is_enabled() else None
    page.locator('#selectionZoom').click();assert float(page.locator('#viewSpan').input_value())>=.25
    page.locator('#raw').uncheck();page.locator('#raw').check()
    page.locator('#next').click();assert page.locator('#note').input_value()=='1'
    page.locator('#source').select_option('vocals.wav');page.wait_for_function("document.getElementById('status').textContent.startsWith('已加载')",timeout=120000)
    page.locator('#spectral').check();page.wait_for_function("document.getElementById('spectrumStatus').textContent.includes('频率 bin')",timeout=30000)
    assert page.locator('#spectrum').is_visible()
    # CSS height must not multiply on high-DPI redraws.
    assert page.locator('#pitch').bounding_box()['height']==380
    page.locator('#synth').click();page.wait_for_timeout(250);assert '合成音' in page.locator('#status').inner_text();page.locator('#stop').click()
    page.locator('#loopPlay').click();page.wait_for_function("!document.getElementById('audio').paused");assert page.locator('#loop').is_checked();page.locator('#stop').click()
    page.locator('#clearRange').click();assert not page.locator('#loop').is_checked()
    c=page.locator('#pitch').bounding_box();page.mouse.move(c['x']+110,c['y']+140);page.mouse.down();page.mouse.move(c['x']+220,c['y']+140,steps=10);page.mouse.up()
    assert float(page.locator('#end').input_value())>float(page.locator('#start').input_value())
    with page.expect_download() as download:page.locator('#export').click()
    assert download.value.suggested_filename.endswith('.json')
    page.screenshot(path='/tmp/audio-debug-'+('real' if args.project else 'fixture')+'.png',full_page=True)
    page.set_viewport_size({'width':700,'height':900});page.wait_for_timeout(200);assert page.locator('#pitch').bounding_box()['width']<700
    page.goto('http://jianpu-test.local/?project='+project_id+'&tab=audioDebug')
    assert page.locator('#tabAudioDebug').get_attribute('aria-selected')=='true'
    debug=page.frame_locator('#audioDebugFrame');debug.locator('#status').filter(has_text='已加载').wait_for(timeout=120000)
    page.locator('#tabTranscribe').click();assert page.locator('#audioDebugPanel').is_hidden()
    assert not errors,errors;assert not writes,writes
    print('PASS: time-aligned score/source switching/click-to-evidence/playhead, wave + worker, pitch/core timing, high-DPI, zoom, selection, source switch, spectrum, synthesis, looping, export, responsive layout, project navigation; no mutations or browser errors')
    browser.close()

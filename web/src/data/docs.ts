export interface DocSection {
  id: string;
  title: string;
  iconName: string;
  content: string;
}

export const docSections: DocSection[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    iconName: 'Rocket',
    content: `
      <h3>Prerequisites</h3>
      <ul>
        <li><strong>Windows 10 or 11</strong></li>
        <li>A USB webcam <em>or</em> a phone with a camera and a browser &mdash; no phone app needed</li>
      </ul>
      <p>No microphone required. ReplaySwing watches your swing through the camera itself.</p>

      <h3>Installation</h3>
      <ol>
        <li>Download the installer from the <a href="#download">Download section</a> or the <a href="https://github.com/theroadeldorado/replay-swing/releases/latest" target="_blank" rel="noopener noreferrer">GitHub Releases</a> page.</li>
        <li>Run <code>ReplaySwing-Setup.exe</code> &mdash; no admin privileges required.</li>
        <li>Launch <strong>ReplaySwing</strong> from the Start Menu or desktop shortcut.</li>
      </ol>

      <h3>First Launch</h3>
      <ol>
        <li>Click <strong>Add camera</strong> and pick your webcam &mdash; a live preview appears immediately.</li>
        <li>Click <strong>Arm</strong> (or press <kbd>A</kbd>). The tally strip at the top of the window turns amber: the app is watching.</li>
        <li>Address the ball and hold still for a beat &mdash; the strip locks green (<strong>SET</strong>).</li>
        <li>Swing. The app records automatically and loops the replay on screen.</li>
      </ol>
      <p>Recordings are saved to <code>~/GolfSwings/</code>, organized by session timestamp.</p>
    `,
  },
  {
    id: 'camera-setup',
    title: 'Camera Setup',
    iconName: 'Camera',
    content: `
      <h3>USB Cameras</h3>
      <p>Plug in any USB webcam and click <strong>Add camera</strong> &mdash; ReplaySwing uses the same camera engine as Chrome, so if your camera works in a browser, it works here. Hot-plug is detected automatically.</p>
      <p>For best results, use a camera that supports <strong>720p or higher</strong>.</p>

      <h3>Multi-Camera Recording</h3>
      <p>Add up to four cameras (USB and phones can mix). When a swing triggers, every camera saves its own clip from the same moment:</p>
      <ul>
        <li>Primary: <code>shot_0001.mp4</code></li>
        <li>Secondary: <code>shot_0001_cam1.mp4</code></li>
      </ul>
      <p>The live view auto-layouts cameras: 1 &rarr; full, 2 &rarr; side-by-side, 3&ndash;4 &rarr; 2&times;2 grid.</p>

      <h3>The Trigger Camera</h3>
      <p>One camera is the <strong>trigger camera</strong> &mdash; the one that watches for your swing. Pick it in Settings. A face-on or down-the-line camera with a clear view of you at address works best.</p>
    `,
  },
  {
    id: 'phone-as-camera',
    title: 'Phone as Camera',
    iconName: 'Smartphone',
    content: `
      <p>Any phone becomes a wireless camera in about ten seconds &mdash; no app to install.</p>

      <h3>Pairing</h3>
      <ol>
        <li>Click <strong>Add phone</strong> in ReplaySwing. A QR code appears.</li>
        <li>Scan it with your phone's camera. The pairing page opens in your phone's browser.</li>
        <li>Tap <strong>Start camera</strong> and allow camera access.</li>
        <li>The phone's feed appears in ReplaySwing as a normal camera tile.</li>
      </ol>

      <h3>While Connected</h3>
      <ul>
        <li>Keep the pairing page open &mdash; the app keeps your phone's screen awake for you.</li>
        <li>Use <strong>Flip camera</strong> on the phone to switch between front and back lenses.</li>
        <li>If the phone locks or drops, ReplaySwing holds its spot and reconnects when the page returns.</li>
      </ul>

      <h3>Requirements</h3>
      <ul>
        <li>Phone and PC on the <strong>same Wi-Fi network</strong> (not cellular data).</li>
        <li>Guest networks often isolate devices from each other &mdash; use your main network.</li>
      </ul>
      <p>Video streams directly from your phone to your PC over your local network. It never touches the internet.</p>
    `,
  },
  {
    id: 'vision-trigger',
    title: 'Swing Detection',
    iconName: 'Circle',
    content: `
      <p>ReplaySwing detects swings by <em>watching</em>, not listening. No microphone, no impact sound tuning.</p>

      <h3>How It Works</h3>
      <p>A golf swing has an unmistakable motion signature: you settle into address and hold still, then move fast. When armed, the app looks for exactly that sequence on the trigger camera:</p>
      <ol>
        <li><strong>WATCHING</strong> (amber) &mdash; armed, waiting for you to address the ball.</li>
        <li><strong>SET</strong> (green) &mdash; you've been still for a moment; the trigger is live.</li>
        <li><strong>CAPTURE</strong> (red) &mdash; swing detected; the clip is being saved.</li>
      </ol>
      <p>The tally strip across the top of the window shows the current state, readable from across the bay. Walking through the frame or a practice waggle won't fire it &mdash; only a still address followed by a swing.</p>

      <h3>Sensitivity</h3>
      <p>The detector calibrates itself to your camera and lighting automatically. If it misses soft swings (or fires too eagerly), adjust <strong>Trigger sensitivity</strong> in Settings: Low needs a hard swing, High fires on chips and putts.</p>

      <h3>Manual Trigger</h3>
      <p>The <strong>Record now</strong> button (or <kbd>T</kbd>) captures the last few seconds at any moment, armed or not &mdash; the buffer is always running while cameras are live.</p>
    `,
  },
  {
    id: 'recording-replay',
    title: 'Recording & Replay',
    iconName: 'Play',
    content: `
      <h3>Pre-Roll Buffer</h3>
      <p>ReplaySwing continuously buffers every camera in memory, so a trigger saves footage from <em>before</em> the moment it fired &mdash; your full backswing is always in the clip. Defaults: <strong>2s before</strong> and <strong>4s after</strong> the trigger, adjustable in Settings.</p>

      <h3>Instant Replay</h3>
      <p>The moment a clip saves, it takes over the main view and loops. You stay armed the whole time &mdash; step up and hit the next ball, and the new swing replaces the replay. Press <kbd>Esc</kbd> or click <strong>Back to live</strong> to return to the camera view.</p>

      <h3>Files</h3>
      <p>Clips are H.264 MP4s that play anywhere &mdash; Windows, phones, editing apps. Each session gets a folder in <code>~/GolfSwings/</code> with per-camera MP4s, JPG thumbnails, and a <code>clips.json</code> index.</p>
    `,
  },
  {
    id: 'pip',
    title: 'PiP Overlay',
    iconName: 'PictureInPicture2',
    content: `
      <p>The PiP window floats on top of everything &mdash; including your fullscreen simulator &mdash; and mirrors whatever ReplaySwing is showing: live cameras between shots, the looping replay after each swing.</p>

      <h3>Using It</h3>
      <ul>
        <li>Click <strong>PiP</strong> in the toolbar (or press <kbd>P</kbd>) to open or close it.</li>
        <li>Drag it anywhere on the sim screen; resize from the edges.</li>
        <li>Its position and size are remembered between sessions.</li>
      </ul>
      <p>Because it mirrors the main app, there's nothing to configure &mdash; arm once, and every replay appears over your simulator automatically.</p>
    `,
  },
  {
    id: 'session-management',
    title: 'Sessions & Shots',
    iconName: 'FolderOpen',
    content: `
      <h3>The Shot Rail</h3>
      <p>Every capture lands in the rail on the right with a thumbnail, shot number, and time. Click any shot to replay it on the main stage.</p>

      <h3>Pin & Delete</h3>
      <ul>
        <li>Hover a shot and click <strong>&#9734;</strong> to pin your best swings.</li>
        <li>Hover and click <strong>&#10005;</strong> to delete a mishit &mdash; the video files go with it.</li>
      </ul>

      <h3>Sessions</h3>
      <p>Each app run records into a new session folder named by date and time. Use the dropdown at the top of the rail to browse earlier sessions &mdash; including ones recorded with older versions of ReplaySwing.</p>
    `,
  },
  {
    id: 'keyboard-shortcuts',
    title: 'Keyboard Shortcuts',
    iconName: 'Keyboard',
    content: `
      <table>
        <thead><tr><th>Key</th><th>Action</th></tr></thead>
        <tbody>
          <tr><td><kbd>A</kbd></td><td>Arm / disarm the swing trigger</td></tr>
          <tr><td><kbd>T</kbd></td><td>Record now (manual trigger)</td></tr>
          <tr><td><kbd>P</kbd></td><td>Show / hide the PiP overlay</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Dismiss replay, back to live view</td></tr>
        </tbody>
      </table>
    `,
  },
  {
    id: 'settings',
    title: 'Settings',
    iconName: 'Settings',
    content: `
      <table>
        <thead><tr><th>Setting</th><th>Range</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td>Pre-roll</td><td>0.5&ndash;5s</td><td>Seconds kept from before the trigger &mdash; covers your backswing</td></tr>
          <tr><td>Post-roll</td><td>1&ndash;8s</td><td>Seconds recorded after the trigger &mdash; covers the finish and ball flight</td></tr>
          <tr><td>Trigger sensitivity</td><td>Low / Medium / High</td><td>How hard a motion spike must be to fire</td></tr>
          <tr><td>Trigger camera</td><td>Any camera</td><td>Which camera watches for the swing</td></tr>
        </tbody>
      </table>
      <p>Settings save automatically to <code>~/GolfSwings/settings.v2.json</code>. Window and PiP positions are remembered too.</p>
    `,
  },
  {
    id: 'troubleshooting',
    title: 'Troubleshooting',
    iconName: 'LifeBuoy',
    content: `
      <h3>The trigger doesn't fire</h3>
      <ul>
        <li>Check the tally strip: it must reach green (<strong>SET</strong>) before a swing counts. Hold still at address for about a second.</li>
        <li>Raise <strong>Trigger sensitivity</strong> in Settings.</li>
        <li>Make sure the <strong>trigger camera</strong> actually sees you &mdash; check which camera is selected in Settings.</li>
      </ul>

      <h3>It fires when it shouldn't</h3>
      <ul>
        <li>Lower the sensitivity.</li>
        <li>Point the trigger camera so people walking behind you aren't in frame.</li>
      </ul>

      <h3>Phone won't connect</h3>
      <ul>
        <li>Phone and PC must be on the <strong>same Wi-Fi</strong>. Turn off cellular data to be sure.</li>
        <li>Guest and hotel-style networks often block devices from seeing each other.</li>
        <li>Re-scan the QR code &mdash; pairing codes expire after a few minutes.</li>
      </ul>

      <h3>Capture problems on a specific PC</h3>
      <p>Run the built-in hardware check from Command Prompt and include its output in a bug report:</p>
      <pre><code>"%LOCALAPPDATA%\\Programs\\ReplaySwing\\ReplaySwing.exe" --spike=encode</code></pre>

      <h3>Reporting bugs</h3>
      <p>Use the <a href="/#support">bug report form</a> &mdash; logs live in <code>~/GolfSwings/logs/</code> if you want to attach detail.</p>
    `,
  },
];

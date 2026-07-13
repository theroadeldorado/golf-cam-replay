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
        <li>A microphone (built-in, USB, or phone mic) if using audio or hybrid trigger mode</li>
      </ul>

      <h3>Installation</h3>
      <ol>
        <li>Download the installer from the <a href="/#download">Download section</a> or the <a href="https://github.com/theroadeldorado/replay-swing/releases/latest" target="_blank" rel="noopener noreferrer">GitHub Releases</a> page.</li>
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

      <h3>Camera Controls</h3>
      <p>Each camera tile has controls for adjusting the view:</p>
      <ul>
        <li><strong>Zoom</strong> &mdash; zoom in to crop the frame closer</li>
        <li><strong>Rotate</strong> &mdash; rotate the image in 90&deg; increments</li>
        <li><strong>Mirror</strong> &mdash; flip the image horizontally (useful for face-on cameras)</li>
      </ul>

      <h3>Multi-Camera Recording</h3>
      <p>Add up to four cameras (USB and phones can mix). When a swing triggers, every camera saves its own clip from the same moment:</p>
      <ul>
        <li>Primary: <code>shot_0001.mp4</code></li>
        <li>Secondary: <code>shot_0001_cam1.mp4</code></li>
      </ul>
      <p>The live view auto-layouts cameras: 1 &rarr; full, 2 &rarr; side-by-side, 3&ndash;4 &rarr; 2&times;2 grid.</p>

      <h3>The Primary Camera</h3>
      <p>One camera is the <strong>primary camera</strong> &mdash; the one whose footage is used as the main replay angle. It&rsquo;s also the camera that drives the vision trigger and auto-arm pose detection. Pick it in Settings.</p>
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
        <li>Phone microphones can be used as your audio trigger source &mdash; select the phone in the Microphone setting.</li>
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
    id: 'trigger-modes',
    title: 'Trigger Modes',
    iconName: 'Circle',
    content: `
      <p>ReplaySwing supports three trigger modes, selectable in Settings:</p>

      <h3>Hybrid (Recommended)</h3>
      <p>Combines motion detection with audio confirmation for the most reliable triggering. The app watches the primary camera for the swing sequence &mdash; still address followed by fast motion &mdash; then confirms with the impact sound from your microphone. This virtually eliminates false triggers.</p>

      <h3>Audio Only</h3>
      <p>Listens for any loud sound above the configured threshold. Simple and works with any camera angle, but can trigger on non-swing sounds. Good for environments where the camera can&rsquo;t see the golfer clearly.</p>

      <h3>Manual Only</h3>
      <p>No automatic triggering. Press <strong>Record now</strong> (or <kbd>T</kbd>) to capture whenever you want. The buffer is always running while cameras are live, so the pre-roll footage is still captured.</p>

      <h3>The Tally Strip</h3>
      <p>The tally strip across the top of the window shows the current trigger state, readable from across the bay:</p>
      <ol>
        <li><strong>WATCHING</strong> (amber) &mdash; armed, waiting for you to address the ball.</li>
        <li><strong>SET</strong> (green) &mdash; you&rsquo;ve been still for a moment; the trigger is live.</li>
        <li><strong>CAPTURE</strong> (red) &mdash; swing detected; the clip is being saved.</li>
      </ol>
    `,
  },
  {
    id: 'auto-arm',
    title: 'Auto-Arm',
    iconName: 'Star',
    content: `
      <p>Enable <strong>Auto-arm when a person steps into view</strong> in Settings for fully hands-free operation.</p>

      <h3>How It Works</h3>
      <p>ReplaySwing uses pose detection on the primary camera to detect when someone is standing in frame. When a person is detected for about 1.5 seconds, the system automatically arms. When they leave the frame for about 5 seconds, it disarms.</p>

      <h3>Manual Override</h3>
      <p>Manual arm/disarm always takes priority. If you manually disarm while auto-arm is active, the system stays disarmed until you leave the frame and return (a full reset cycle). You can always arm or disarm manually regardless of the auto-arm setting.</p>

      <h3>Works With Any Trigger Mode</h3>
      <p>Auto-arm controls <em>when</em> the system is armed. The trigger mode (hybrid, audio, manual) controls <em>what</em> causes a capture. They work together:</p>
      <ul>
        <li><strong>Hybrid + auto-arm</strong> &mdash; walk up, system arms, swing triggers on motion + sound</li>
        <li><strong>Audio + auto-arm</strong> &mdash; walk up, system arms, swing triggers on impact sound</li>
        <li><strong>Manual + auto-arm</strong> &mdash; walk up, system arms, press Record to capture</li>
      </ul>
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

      <h3>Slow Motion</h3>
      <p>Drag the speed slider on the replay bar from <strong>1&times;</strong> down to <strong>0.1&times;</strong> to study the moment through impact in slow motion. It works on the instant replay and on any shot you pick from the rail.</p>

      <h3>Files</h3>
      <p>Clips are H.264 MP4s that play anywhere &mdash; Windows, phones, editing apps. Each session gets a folder in <code>~/GolfSwings/</code> with per-camera MP4s, JPG thumbnails, and a <code>clips.json</code> index.</p>
    `,
  },
  {
    id: 'drawing-tools',
    title: 'Drawing Tools',
    iconName: 'PenTool',
    content: `
      <p>Mark up any swing with lines and circles &mdash; a swing-plane line, an alignment circle on the ball or your head.</p>

      <h3>Drawing</h3>
      <ol>
        <li>Click the <strong>pencil</strong> at the top-left of the video.</li>
        <li>Pick <strong>Line</strong> or <strong>Circle</strong> and a color, then drag on the video.</li>
        <li>Switch to <strong>Select</strong> to move a shape, drag a line&rsquo;s ends to re-angle it, or drag a circle&rsquo;s edge to resize. A swatch recolors the selected shape; <kbd>Delete</kbd> removes it.</li>
      </ol>

      <h3>Where drawings live</h3>
      <p>Drawings belong to each camera and are saved between sessions. They appear on that camera&rsquo;s live view, on its replays, and burned into the PiP overlay on your sim screen. Turn the pencil off and they stay on screen without getting in the way.</p>
    `,
  },
  {
    id: 'compare-swings',
    title: 'Compare Swings',
    iconName: 'Columns2',
    content: `
      <p>Put two swings side by side to see what changed &mdash; today&rsquo;s move against a reference from last week.</p>

      <h3>Opening a comparison</h3>
      <ol>
        <li>Click <strong>Compare</strong> in the toolbar. A window opens with two panes.</li>
        <li>Use the dropdown above each pane to pick a shot. Shots are grouped by session, so you can compare across different days.</li>
      </ol>

      <h3>Studying the swings</h3>
      <ul>
        <li>Both clips play on one timeline &mdash; play/pause, scrub, and slow-motion speeds apply to both at once.</li>
        <li>Step through frame by frame with the frame buttons.</li>
        <li>The two swings rarely start at the same instant, so use the <strong>offset</strong> (&minus; / &plus;) to nudge the right swing until both line up at the same moment &mdash; the top of the backswing, or impact.</li>
      </ul>
    `,
  },
  {
    id: 'share-save',
    title: 'Share & Save',
    iconName: 'Share2',
    content: `
      <p>Get any clip off your PC without cables or cloud uploads. Both buttons sit on the replay bar.</p>

      <h3>Send to your phone</h3>
      <ol>
        <li>Play a shot, click <strong>Share</strong>, and a QR code appears.</li>
        <li>Scan it with your phone&rsquo;s camera &mdash; a page opens that plays the swing with a Save button.</li>
        <li>Share more shots and they appear on the same page automatically, so you only scan once.</li>
      </ol>
      <p>Your phone must be on the <strong>same Wi-Fi</strong> as your PC. The video streams directly between them and never touches the internet. On iPhone, long-press the video and choose &ldquo;Save to Photos&rdquo;; on Android, use the Save button.</p>

      <h3>Save to your PC</h3>
      <p>Click <strong>Save</strong> to copy the clip anywhere on your computer &mdash; to a coaching folder, a USB drive, or your desktop.</p>
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
          <tr><td><kbd>Delete</kbd></td><td>Remove the selected drawing (while drawing)</td></tr>
          <tr><td><kbd>Esc</kbd></td><td>Exit drawing, dismiss replay, or close the compare window</td></tr>
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
        <thead><tr><th>Setting</th><th>Options / Range</th><th>What it does</th></tr></thead>
        <tbody>
          <tr><td>Shots folder</td><td>Any directory</td><td>Where sessions and clips are saved (default: <code>~/GolfSwings/</code>)</td></tr>
          <tr><td>Trigger mode</td><td>Hybrid / Audio / Manual</td><td>How auto-recording is triggered &mdash; hybrid is recommended</td></tr>
          <tr><td>Microphone</td><td>Any mic or phone</td><td>Audio source for the trigger (shown when trigger uses audio)</td></tr>
          <tr><td>Trigger threshold</td><td>0.01&ndash;0.4</td><td>Audio level that fires the trigger &mdash; lower is more sensitive</td></tr>
          <tr><td>Pre-roll</td><td>0.5&ndash;5s</td><td>Seconds kept from before the trigger &mdash; covers your backswing</td></tr>
          <tr><td>Post-roll</td><td>1&ndash;8s</td><td>Seconds recorded after the trigger &mdash; covers the finish and ball flight</td></tr>
          <tr><td>Primary camera</td><td>Any camera</td><td>Which camera is used as the main replay angle and for vision detection</td></tr>
          <tr><td>Auto-arm</td><td>On / Off</td><td>Automatically arm when a person steps into the primary camera&rsquo;s view</td></tr>
        </tbody>
      </table>
      <p>Settings save automatically to <code>~/GolfSwings/settings.v2.json</code>. Window and PiP positions are remembered too. The current app version is displayed at the bottom of the settings panel.</p>
    `,
  },
  {
    id: 'feedback',
    title: 'Feedback & Bug Reports',
    iconName: 'LifeBuoy',
    content: `
      <h3>In-App Feedback</h3>
      <p>Click the <strong>Feedback</strong> button in the app toolbar to submit a bug report or feature request directly from ReplaySwing. Your system info (OS, app version, camera count) is attached automatically. Feedback is submitted as a GitHub issue &mdash; no browser window opens, it&rsquo;s all handled in the app.</p>

      <h3>Website Bug Report</h3>
      <p>Use the <a href="/#bug-report">bug report form</a> on the website to file issues from any device.</p>

      <h3>Troubleshooting</h3>

      <h4>The trigger doesn't fire</h4>
      <ul>
        <li>Check the tally strip: it must reach green (<strong>SET</strong>) before a swing counts. Hold still at address for about a second.</li>
        <li>If using hybrid or audio mode, check that your microphone is working &mdash; the level preview in Settings should bounce when you clap.</li>
        <li>Lower the <strong>trigger threshold</strong> in Settings to make it more sensitive.</li>
        <li>Make sure the <strong>primary camera</strong> actually sees you &mdash; check which camera is selected in Settings.</li>
      </ul>

      <h4>It fires when it shouldn't</h4>
      <ul>
        <li>Raise the trigger threshold.</li>
        <li>Switch to <strong>Hybrid</strong> mode &mdash; it requires both motion and sound, which virtually eliminates false triggers.</li>
        <li>Point the primary camera so people walking behind you aren't in frame.</li>
      </ul>

      <h4>Phone won't connect</h4>
      <ul>
        <li>Phone and PC must be on the <strong>same Wi-Fi</strong>. Turn off cellular data to be sure.</li>
        <li>Guest and hotel-style networks often block devices from seeing each other.</li>
        <li>Re-scan the QR code &mdash; pairing codes expire after a few minutes.</li>
      </ul>

      <h4>Capture problems on a specific PC</h4>
      <p>Run the built-in hardware check from Command Prompt and include its output in a bug report:</p>
      <pre><code>"%LOCALAPPDATA%\\Programs\\ReplaySwing\\ReplaySwing.exe" --spike=encode</code></pre>

      <p>Logs live in <code>~/GolfSwings/logs/</code> if you want to attach detail.</p>
    `,
  },
];

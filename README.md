# gg-nelko-p21

Print labels on a **Nelko P21** Bluetooth label printer straight from your browser. It needs no drivers, no account and no install: the page talks to the printer directly over the [Web Serial API](https://developer.mozilla.org/docs/Web/API/Web_Serial_API).

> **Not affiliated with or endorsed by Nelko.** "Nelko" and "P21" are used only to describe the printer this app works with. This is an independent, community-made project.

## Features

- Connect to the P21 over Bluetooth (COM port on Windows, or a direct Bluetooth connection in recent Chrome/Edge)
- Battery level indicator (checked every minute and after each print)
- Printer info panel: status, firmware and hardware versions, and the loaded label roll (size, type, colour) read from its NFC tag
- Multi-line text labels that shrink automatically to fit
- Font, bold, alignment, line spacing, and white-on-black text
- Label size, print darkness, and number of copies
- A pixel-exact preview of what will print
- Remembers your settings between visits
- `Ctrl` + `Enter` to print

## Requirements

- **Chrome or Edge on a desktop computer.** Firefox and Safari don't support Web Serial, and it doesn't work on iPhone or iPad.
- A Nelko P21 printer.

## Using the app

### 1. Pair the printer (one time)

Turn the P21 on, then pair it in your computer's Bluetooth settings.

**Windows:** Settings → Bluetooth & devices → **Add device** → Bluetooth → choose **P21**.

Windows normally creates a serial (COM) port for the printer automatically. To check, open **More Bluetooth settings** (or press `Win`+`R` and run `control bthprops.cpl`) and go to the **COM Ports** tab. The P21 should be listed with the direction **Outgoing**. If it isn't, click **Add…**, choose **Outgoing**, select the P21 and click OK.

**macOS / Linux:** pair it in the system Bluetooth settings. macOS shows it as a `cu.` serial port. On Linux, recent Chrome versions can usually connect to the paired printer directly.

### 2. Connect

1. Open the app in Chrome or Edge.
2. Make sure the printer is on.
3. Click **Connect printer** in the top-right corner.
4. Pick the printer in the browser's list, then click **Connect**. It may show up as **P21**, or as a COM port (on Windows, pick the outgoing port from step 1). If there are two and the first doesn't work, try the other.

The status dot turns green when the printer is connected, and the battery level appears next to it. It updates every minute and after each print; click it to check right away. While the printer is plugged in it shows **Charging** instead of a percentage, because the printer always reports 99% while charging. If the printer turns off or goes out of range, the app shows that it was disconnected; click **Connect printer** again to reconnect.

Click the **ⓘ** button next to the battery level to see printer info:

- **Printer:** status (Ready, Lid open, No labels loaded, …), battery, firmware and hardware versions, resolution, auto power-off, and beep setting.
- **Loaded labels:** the size, type, gap, and colour of the roll in the printer, plus its paper code, read from the NFC tag on genuine rolls. If this doesn't match the app's **Label size**, the panel tells you. Rolls without a readable tag still print fine; just pick the size yourself.

Click **Refresh** in the panel to read everything again.

### 3. Write your label

- **Label text:** type in the text box and press `Enter` to start a new line. The text is made as large as possible and shrinks automatically to fit the label.
- **Font:** Sans, Condensed, Serif, or Mono.
- **Style:** **B** toggles bold; the half-filled circle prints white text on a black background.
- **Align:** left, center, or right.
- **Max size:** caps how big the text can get. Useful for keeping a set of labels consistent.
- **Line spacing:** tighter or looser gaps between lines.

The preview at the top shows exactly what will print, dot for dot. If the text is too long to fit, a warning appears under the preview.

### 4. Print

- **Label size:** pick the size of the label roll that's loaded.
- **Darkness:** 0 (lightest) to 15 (darkest). 7 is a good default; raise it if the print looks faint.
- **Copies:** how many labels to print.

Click **Print label**, or press `Ctrl` + `Enter`.

### Troubleshooting

| Problem | What to try |
| --- | --- |
| "This browser can't talk to serial devices" | Use Chrome or Edge on a desktop computer. |
| The printer isn't in the connect list | Make sure it's paired and turned on. On Windows, check that it has an **Outgoing** COM port (see step 1). |
| "Couldn't open the port" | Close any other app using the printer (such as the Nelko phone app or another label app), turn the printer off and on, then reconnect. |
| Connected, but nothing prints | Try the other COM port for the P21, check the label roll is loaded, and turn the printer off and on. |
| No battery level shows up | The printer didn't answer the battery query. Click **Disconnect**, then connect again. Printing still works either way. |
| Something else isn't working | Open the app with `?debug` at the end of the address (e.g. `http://localhost:5173/?debug`), press F12, and look at the `[P21]` lines in the Console tab. They show every byte sent to and received from the printer. |
| The print is faint or patchy | Raise **Darkness**. |
| Text is cut off | Shorten the text, lower **Line spacing**, or use the **Condensed** font. |

## Development

Requires [Node.js](https://nodejs.org/) 20 or newer.

```bash
npm install
npm run dev     # http://localhost:5173
npm run build   # type-check and build to dist/
npm run lint
```

Web Serial only works on secure pages. `localhost` counts, so the dev server works as is; if you host the app anywhere else, it needs HTTPS.

**On WSL:** run the dev server inside WSL and open `http://localhost:5173` in Chrome or Edge on Windows. The browser reaches the printer through Windows, so nothing Bluetooth-related is needed inside WSL.

### How printing works

1. `src/lib/render.ts` draws the text onto a canvas the size of the label (label length × 96 dots), picks the largest font size that fits, and converts it to pure black and white.
2. `src/lib/protocol.ts` rotates the image 90° clockwise into the printer's 96-dot-wide orientation and wraps it in TSPL print commands:

   ```
   SIZE 14.0 mm,40.0 mm
   GAP 5.0 mm,0 mm
   DIRECTION 1,1
   DENSITY 7
   CLS
   BITMAP 0,0,12,284,0,<3408 bytes, 1 = white>
   PRINT 1
   ```

3. `src/lib/printer.ts` opens the serial port at 115200 baud and sends the job.

## Credits

This app wouldn't exist without the people who figured out how the P21 works:

- [merlinschumacher/nelko-p21-print](https://github.com/merlinschumacher/nelko-p21-print): the original reverse engineering of the P21's Bluetooth protocol.
- [kennedn/nelko-p21](https://github.com/kennedn/nelko-p21): a fork of the above, used as the reference for the exact print-job byte layout.
- [TylerCode/Fyne-P21-Print](https://github.com/TylerCode/Fyne-P21-Print): a desktop P21 app whose features and layout inspired this UI, and the source of the additional label sizes.

This project is an independent TypeScript implementation based on the protocol those projects documented. It doesn't include their code.

## Project status

This is a personal project, shared as-is in case it's useful to someone else. Issues and pull requests are turned off, and I don't take feature requests. If you want something changed, you're welcome to fork it; the [MIT license](LICENSE) lets you do almost anything with it.

## Tip jar

If this app saved you some time and you want to say thanks, tips are welcome (never expected):

- **Ko-fi:** [ko-fi.com/foreignbyproxy](https://ko-fi.com/foreignbyproxy) (card or other payment methods)
- **Ethereum:** `ggerard.eth` (`0x33e69B80C8CB4ECE21AB3e755c6F2052C688d70F`)
  **Ethereum mainnet only.** This is a smart-contract wallet that doesn't exist on other networks, so please don't send on Base, Arbitrum, Optimism, Polygon, or any other chain; those funds can't be recovered.
- **Bitcoin:** `36jAAkpLqXLPwVjWRWPzeAV5iNacQfFNTs`

## License

[MIT](LICENSE) © 2026 foreignbyproxy

## Disclaimer

This project is not affiliated with, endorsed by, or sponsored by Nelko or its parent company. All product names and trademarks belong to their respective owners and are used only to identify compatible hardware. Use this software at your own risk; it is provided "as is", without warranty of any kind (see [LICENSE](LICENSE)).

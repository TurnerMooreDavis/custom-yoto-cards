# Interactive cards: what Phase 0 found (2026-10-17)

- `playbackType: "interactive"` on `content`.
- Track events: `onLhb` / `onRhb` / `onEnd`, each `{ cmd: stop|repeat|goto, params }`
  ([card content schema](https://yoto.dev/reference/card-content-schema/); the schema
  documents no `params` keys).
- goto params shape: `{"chapterKey":"B","trackKey":"01"}`. Measured: `POST /content`
  accepted it on an interactive card and echoed it back unchanged. Player playback of
  the jump was not tested by hand.
- Buttons, from Yoto's own wording (researched, not tested on the player):
  - `Lhb` / `Rhb` = left-hand / right-hand button, Yoto's names for the two orange
    dials (turn them for volume / chapter, press them in as buttons).
  - On interactive cards, choices are made by **pressing** the left and right buttons
    on a Yoto Player or Yoto Mini, so `onLhb` = press the left dial,
    `onRhb` = press the right dial.
  - Interactive cards work on 2nd/3rd Gen players. 4th Gen players and the new Mini
    don't support full interactive cards yet.
  - Sources:
    [Forge Your Quest press release](https://us.yotoplay.com/press/en-US/269184-yoto-debuts-interactive-storytelling-with-dungeons-dragons-forge-your-quest-audio-card/),
    [Interactive cards and 4th Gen players](https://support.yotoplay.com/en_gb/interactive-yoto-cards-and-4th-generation-players-what-you-need-to-know-Sypn8apdzg.md),
    [How to Be a Hero (Interactive Studio MYO)](https://yoto.space/made-by-you/post/how-to-be-a-hero-choose-your-own-adventure-3vkzvCq42CuBtJM).
- Audio upload URL host: `yoto-media-api-prod-uploads.s3.eu-west-2.amazonaws.com`
  (measured).
- `GET /content/{cardId}` needs the scopes `user:content:view` and
  `family:library:view` (it returns 403 without them). The CLI doesn't call it.
- Source: branch test card "SPIKE branch test" (cardId `arZ0X`), uploaded through the
  API.

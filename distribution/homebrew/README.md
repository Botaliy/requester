# Requester Homebrew tap

The contents of this directory are ready to be copied into a public repository named `Botaliy/homebrew-tap`.

Expected repository layout:

```text
homebrew-tap/
└── Casks/
    └── requester.rb
```

Before publishing the cask:

1. Create the `v1.0.0` GitHub Release in `Botaliy/requester`.
2. Upload both `Requester-1.0.0-arm64.dmg` and `Requester-1.0.0-x64.dmg` from `dist/`.
3. Ensure both applications are signed with Developer ID and notarized by Apple.
4. Recalculate the SHA-256 values of the final uploaded DMGs and update `Casks/requester.rb` if signing changed them.
5. Push `Casks/requester.rb` to `Botaliy/homebrew-tap`.

Users can then install Requester with:

```bash
brew install --cask botaliy/tap/requester
```

Updates use the normal Homebrew flow:

```bash
brew update
brew upgrade --cask requester
```

cask "requester" do
  arch arm: "arm64", intel: "x64"

  version "1.0.0"
  sha256 arm:   "41a997e2a557280800220268970ac3f80de137ff6c3efd190c39e5c3d90399b2",
         intel: "e6b9e55661f7abe3f0f9d2b1ee3e2ccf690e1b00d47661d8d69e7a35abc30623"

  url "https://github.com/Botaliy/requester/releases/download/v#{version}/Requester-#{version}-#{arch}.dmg",
      verified: "github.com/Botaliy/requester/"
  name "Requester"
  desc "Desktop WebSocket client for messages, scenarios, variables, and automation"
  homepage "https://github.com/Botaliy/requester"

  app "Requester.app"

  zap trash: [
    "~/Library/Application Support/Requester",
    "~/Library/Application Support/requester",
    "~/Library/Preferences/com.botaliy.requester.plist",
    "~/Library/Saved Application State/com.botaliy.requester.savedState",
  ]
end

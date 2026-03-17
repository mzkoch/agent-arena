class Arena < Formula
  desc "Run multiple autonomous coding agents in isolated git worktrees"
  homepage "https://github.com/agent-arena/agent-arena"
  head "https://github.com/agent-arena/agent-arena.git", branch: "main"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
  end

  test do
    assert_match(/\d+\.\d+\.\d+/, shell_output("#{bin}/arena version").strip)
  end
end

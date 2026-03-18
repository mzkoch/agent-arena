class Arena < Formula
  desc "Run multiple autonomous coding agents in isolated git worktrees"
  homepage "https://github.com/mzkoch/agent-arena"
  head "https://github.com/mzkoch/agent-arena.git", branch: "main"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    system "npm", "run", "build"
    # Install the built artifacts alongside the npm package
    libexec.install Dir["dist/*"]
    libexec.install "bin/arena.cjs"
    (bin/"arena").write_env_script libexec/"arena.cjs", PATH: "#{Formula["node"].opt_bin}:$PATH"
  end

  test do
    assert_match(/\d+\.\d+\.\d+/, shell_output("#{bin}/arena version").strip)
  end
end

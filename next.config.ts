import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Off because React Strict Mode's dev-only double-mount leaves the r3f
  // post-processing EffectComposer (Atlas HUD) in a flickering render state.
  // Dev-only behavior; production was never affected. Re-enable if the 3D
  // view ever stops needing it.
  reactStrictMode: false,
};

export default nextConfig;

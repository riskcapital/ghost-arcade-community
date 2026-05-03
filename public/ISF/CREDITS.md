# ISF Shader Credits

The shaders bundled with Ghost Arcade Community ship in
[`public/ISF/`](../public/ISF/) (this `CREDITS.md` is mirrored there as
well so it travels with the pack). They render under the
[ISF v2 specification](https://isf.video).

## Pack overview

After audit + cleanup the public OSS pack contains **319** shader files
indexed across **248** manifest entries. Every shader is credited.
Distribution by author:

| Credit | Count |
| --- | --- |
| `Ghost Arcade` | 230 |
| `Justin Wood / Ghost Arcade` | 61 |
| `by Justin Robie Wood` | 12 |
| `Grok, created by xAI` | 9 |
| `Adapted from Three.js (MIT) by Ghost Arcade` | 3 |
| `ChatGPT` | 3 |
| `Three-Body Orbits` | 1 |

## License

Unless explicitly noted otherwise per-file, the shaders here are
contributed under the same **AGPL-3.0-or-later** license as the rest of
the repository. Each shader's source includes a `CREDIT` field where the
author + license intent are recorded.

## Attribution

| Source / Author | Notes |
| --- | --- |
| **Ghost Arcade contributors** | Shaders authored directly for this distribution (291 of 319 files combined across the `Ghost Arcade` and `Justin Wood / Ghost Arcade` credits + the 12 `by Justin Robie Wood` files) |
| **AI-assisted generations** | A small subset of files name the LLM that generated them (`Grok` / `xAI`, `ChatGPT`). LLM-generated GLSL is generally treated as un-copyrightable; we keep the attribution as provenance, not a license claim |
| **Three.js examples (MIT)** | Three shaders are GLSL adaptations of patterns from the official Three.js example library. Three.js is MIT-licensed and explicitly permits derivation. |
| **Šuvakov & Dmitrašinović (2013)** | Three-body orbit data used by the `ThreeBody*.fs` family. Periodic three-body orbit catalog. See [arXiv:1303.0181](https://arxiv.org/abs/1303.0181) |
| **Li-Liao catalogs** | Additional equal-mass periodic three-body solutions used by the `ThreeBody*.fs` family |
| **ISF specification** | The `ISF v2` shader format itself, by [VIDVOX](https://www.vidvox.net/) |

## Shaders removed in this distribution

The following Shadertoy-derived shaders were present in the upstream
codebase but have been **removed** from the OSS distribution because their
default Shadertoy license (CC BY-NC-SA 3.0) is incompatible with AGPL-3.0:

- `Pegasus Galaxy.fs` (Frank Hugenroth, 2015)
- `Galaxy of Universes+.fs` (FabriceNeyret2)
- `Melty Boi.fs` (Dave_Hoskins)
- `Neon psy.fs` (LydianLights)
- `InnerDimensionalMatrix.fs` (Inigo Quilez derivative)
- `AnotherGridThingy.fs` (mojovideotech / GLSL Sandbox, CC BY-NC-SA 3.0)
- `grigM_gs61327.fs` (GLSL Sandbox conversion, no AGPL-compatible license)
- `Untitled Shader.fs` (GLSL Sandbox conversion, no AGPL-compatible license)

If you want to use these in a fork, contact the original authors for
explicit AGPL-compatible permission, or replace with original work.

## Renamed shaders

Some shader filenames previously implied attribution to specific artists
without explicit license. They've been renamed to neutral names:

- `00-vangogh.fs` → `00-impasto.fs`
- `00-refikky.fs` → `00-data-flow.fs`

The shader source itself is original; only the filename was changed.

## Codename normalization

The upstream Pro codebase used internal project codenames in shader
`CREDIT` fields. These were normalized to the public-facing brand for
the OSS distribution. The shader source is unchanged; only the metadata
was updated:

- `"GhostArcade"` → `"Ghost Arcade"`
- `"Ghost Arcade"` → `"Ghost Arcade"`
- `"Shrink Wrap"` → `"Ghost Arcade"`
- `"Justin / Syntax Projects"` → `"Justin Wood / Ghost Arcade"`
- `"Justin / Elite Results Marketing"` → `"Justin Wood / Ghost Arcade"`
- `"Converted from Three.js by Claude"` → `"Adapted from Three.js (MIT) by Ghost Arcade"`
- `"Your Name"` (placeholder) → `"Ghost Arcade"`

## Adding new shaders

Contributors: please include a `CREDIT` block at the top of every new
`.fs` file. Example:

```glsl
/*{
  "CREDIT": "Your Name <your@email>",
  "DESCRIPTION": "What this shader does",
  "LICENSE": "AGPL-3.0-or-later"
}*/
```

If your shader is derived from another source (Shadertoy, GLSL Sandbox,
research paper), the source URL and the original license MUST be in the
CREDIT block, and the original license MUST be AGPL-compatible (most
permissive licenses are; CC BY-NC-* and proprietary licenses are not).

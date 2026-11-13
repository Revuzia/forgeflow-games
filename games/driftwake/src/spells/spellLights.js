/**
 * The dynamic lights spells emit.
 *
 * A tiny fixed pool — four slots, two pre-allocated Float32Arrays, no objects.
 * Spells declare their light each frame while they update; whatever is declared
 * by the end of the frame is what the materials see. Nothing is retained between
 * frames, so a spell that stops updating stops lighting with no teardown.
 *
 * Every material that shades something the player can see reads the same two
 * arrays through `lib/spellLights`. That is the point: a spell has to light the
 * snow, the robe, the wake and the airborne spray out of one description, or it
 * reads as a glow pasted over a scene rather than as a light in it.
 *
 * PORT NOTE — how a consumer gets the values.
 *
 * Babylon's `material.setArray4()` copies into the material's own uniform
 * buffer, so the reference pushes the pool into every consumer once per frame.
 * Three keeps a `{ value }` box per uniform and reads it at draw time, so there
 * are two ways to be a consumer and both are supported:
 *
 *   share   the material is built with `...spells.lights.uniforms` spread into
 *           its uniform map (this is what `Terrain`'s `deps.spellUniforms` hook
 *           is for). Nothing further is needed — `commit()` writes the count and
 *           the arrays are already the same objects.
 *   copy    the material owns its own boxes; `addConsumers(mat)` registers it and
 *           `apply(mat)` copies the pool into them in place, allocation-free.
 *
 * Allocation per frame: none.
 */

/** Must match `SPELL_LIGHT_MAX` in `lib/spellLights`. */
export const MAX_SPELL_LIGHTS = 4;

/**
 * Uniform names every consumer material must declare. Exported so the material
 * constructors cannot drift from the include.
 */
export const SPELL_LIGHT_UNIFORMS = [
    "spellLightPos", "spellLightCol", "spellLightCount",
];

export class SpellLights {
    constructor() {
        /** (x, y, z, radius) per slot. */
        this.pos = new Float32Array(MAX_SPELL_LIGHTS * 4);
        /** (r, g, b, intensity) per slot. */
        this.col = new Float32Array(MAX_SPELL_LIGHTS * 4);
        this.count = 0;
        /** Multiplier the overlay drives (S.spellLight), so the effect can be A/B'd. */
        this.scale = 1;

        /**
         * The `lib/spellLights` uniform block, ready to spread into any material
         * that wants to share the pool by reference rather than by copy.
         * @type {Record<string, {value:any}>}
         */
        this.uniforms = {
            spellLightPos: { value: this.pos },
            spellLightCol: { value: this.col },
            spellLightCount: { value: 0 },
        };
    }

    /** Drop last frame's declarations. Called once, before the spells update. */
    begin() {
        this.count = 0;
    }

    /**
     * Declare a light for this frame.
     *
     * Dropped silently once the pool is full. That is the right failure: the
     * fifth light in a frame is by definition the least important one on screen,
     * and the alternative — growing the array — means a shader loop the whole
     * snow field pays for.
     *
     * @param {number} x @param {number} y @param {number} z
     * @param {number} radius metres; the falloff reaches exactly zero here
     * @param {number} r @param {number} g @param {number} b linear, unnormalised
     * @param {number} intensity
     */
    add(x, y, z, radius, r, g, b, intensity) {
        if (this.count >= MAX_SPELL_LIGHTS) return;
        if (intensity <= 0 || radius <= 0) return;
        const i = this.count++;
        const o = i * 4;
        this.pos[o] = x;
        this.pos[o + 1] = y;
        this.pos[o + 2] = z;
        this.pos[o + 3] = radius;
        const k = intensity * this.scale;
        this.col[o] = r;
        this.col[o + 1] = g;
        this.col[o + 2] = b;
        this.col[o + 3] = k;
    }

    /**
     * Publish the count into the shared uniform block. Called once, after the
     * last declaration of the frame and before anything renders.
     *
     * The arrays themselves need no republishing for share-mode consumers: they
     * hold the very objects the spells just wrote into.
     */
    commit() {
        this.uniforms.spellLightCount.value = this.count;
    }

    /**
     * Make one material a consumer, once, at registration time.
     *
     * A material whose uniform map has no `spellLight*` entries at all would never
     * receive them however often `apply()` ran: Three builds each program's upload
     * list by intersecting the program's active uniforms with `material.uniforms`
     * at first draw, so a box added afterwards is simply not in the list. Binding
     * the pool's own objects in — by reference, which also skips the per-frame
     * copy — is both the fix and the faster path.
     *
     * @param {{uniforms?: Record<string, {value:any}>}} m
     */
    bind(m) {
        const u = m && m.uniforms;
        if (!u) return;
        if (!u.spellLightPos) u.spellLightPos = this.uniforms.spellLightPos;
        if (!u.spellLightCol) u.spellLightCol = this.uniforms.spellLightCol;
        if (!u.spellLightCount) u.spellLightCount = this.uniforms.spellLightCount;
    }

    /**
     * Push the pool into one copy-mode material.
     *
     * The whole array goes across whether or not every slot is live — a partial
     * copy would leave the tail holding a stale radius, and the shader's own gate
     * is the count rather than the contents.
     *
     * A material that already shares this object graph is detected by identity
     * and skipped, so registering a share-mode consumer is harmless.
     *
     * @param {{uniforms?: Record<string, {value:any}>}} m
     */
    apply(m) {
        const u = m && m.uniforms;
        if (!u) return;
        const p = u.spellLightPos;
        if (p && p.value !== this.pos && p.value && p.value.set) p.value.set(this.pos);
        const c = u.spellLightCol;
        if (c && c.value !== this.col && c.value && c.value.set) c.value.set(this.col);
        const n = u.spellLightCount;
        if (n) n.value = this.count;
    }
}

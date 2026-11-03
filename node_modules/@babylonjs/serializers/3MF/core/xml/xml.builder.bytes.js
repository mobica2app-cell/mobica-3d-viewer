/** */
export class Utf8XmlWriterToBytes {
    constructor(_sink, _opts = {}) {
        this._sink = _sink;
        this._opts = _opts;
        /** */
        this.count = 0;
        this._encoder = new TextEncoder();
        this._pending = "";
        this._pendingChars = 0;
    }
    /**
     * @param data
     * @returns
     */
    write(...data) {
        if (data.length === 0) {
            return this;
        }
        const s = data.join("");
        if (s.length === 0) {
            return this;
        }
        this._pending += s;
        this._pendingChars += s.length;
        const limit = this._opts.flushChars ?? 64 * 1024;
        if (this._pendingChars >= limit) {
            this.flush();
        }
        return this;
    }
    /**
     * @returns
     */
    flush() {
        if (this._pendingChars === 0) {
            return this;
        }
        const bytes = this._encoder.encode(this._pending);
        this._sink.push(bytes);
        this.count += bytes.length;
        this._pending = "";
        this._pendingChars = 0;
        return this;
    }
    /**
     */
    finish() {
        this.flush();
        this._sink.push(new Uint8Array(0), true);
    }
    /**
     */
    clear() {
        this._pending = "";
        this._pendingChars = 0;
        this.count = 0;
    }
}
//# sourceMappingURL=xml.builder.bytes.js.map
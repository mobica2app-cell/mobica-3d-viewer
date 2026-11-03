/** */
export class StringXmlWriter {
    constructor() {
        /** */
        this.count = 0;
        this._chunks = [];
    }
    /**
     * @param data
     * @returns
     */
    write(...data) {
        if (data.length === 0) {
            return this;
        }
        // join once per call, keeps DOM out, very fast
        const s = data.join("");
        this._chunks.push(s);
        this.count += s.length;
        return this;
    }
    /**
     * @returns
     */
    toString() {
        return this._chunks.join("");
    }
    /**
     */
    clear() {
        this._chunks = [];
        this.count = 0;
    }
}
//# sourceMappingURL=xml.builder.string.js.map
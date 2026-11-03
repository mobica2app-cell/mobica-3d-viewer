/** */
class XmlSyntax {
}
/** */
XmlSyntax.OpenTag = "<";
/** */
XmlSyntax.CloseTag = ">";
/** */
XmlSyntax.Slash = "/";
/** */
XmlSyntax.Question = "?";
/** */
XmlSyntax.Quote = '"';
/** */
XmlSyntax.Equal = "=";
/** */
XmlSyntax.Space = " ";
/** */
XmlSyntax.Semicolon = ":";
/** */
XmlSyntax.Dec = "<?xml";
/** */
XmlSyntax.Xml = "xml";
/** */
XmlSyntax.Xmlns = "xmlns";
/** */
XmlSyntax.Xsi = "xsi";
/** */
XmlSyntax.VersionKeyword = "version";
/** */
XmlSyntax.EncodingKeyword = "encoding";
/** */
XmlSyntax.StandaloneKeyword = "standalone";
/** */
export var TokenType;
(function (TokenType) {
    TokenType[TokenType["Declaration"] = 0] = "Declaration";
    TokenType[TokenType["Tag"] = 1] = "Tag";
    TokenType[TokenType["Attribute"] = 2] = "Attribute";
    TokenType[TokenType["Text"] = 3] = "Text";
})(TokenType || (TokenType = {}));
/** */
export class XmlBuilder {
    constructor(w) {
        /** */
        this._ctxStack = [];
        /** */
        this._d = 0;
        this._w = w;
    }
    /**
     *
     * @param version
     * @param encoding
     * @param standalone
     * @returns
     */
    dec(version, encoding, standalone) {
        this._w.write(XmlSyntax.Dec);
        this._writeAttStr(XmlSyntax.VersionKeyword, version);
        if (encoding) {
            this._writeAttStr(XmlSyntax.EncodingKeyword, encoding);
        }
        if (standalone !== undefined) {
            this._writeAttStr(XmlSyntax.StandaloneKeyword, standalone ? "yes" : "no");
        }
        this._w.write(XmlSyntax.Question, XmlSyntax.CloseTag);
        return this;
    }
    /**
     *
     * @param ns
     * @param n
     * @param v
     * @returns
     */
    att(ns, n, v) {
        const ctx = this._peekContext();
        if (!ctx) {
            throw new Error("att() without open element");
        }
        if (ctx.closed) {
            throw new Error(`att() after start tag closed for <${ctx.name}>`);
        }
        // explicit namespace declaration: xmlns or xmlns:prefix
        if (this._isXmlnsDecl(ns, n)) {
            if (n === XmlSyntax.Xmlns) {
                // default namespace
                ctx.defaultNs = v;
                // you can store default as empty prefix if you want
                this._registerNamespace(ctx, "", v);
                this._writeAttStr(XmlSyntax.Xmlns, v);
            }
            else {
                if (!ns) {
                    const prefix = n.slice(6); // "xmlns:"
                    this._registerNamespace(ctx, prefix, v);
                    this._writeAttStr(n, v);
                }
                else {
                    this._registerNamespace(ctx, n, v);
                    this._writeAttStr(`${ns}:${n}`, v);
                }
            }
            ctx.lastToken = TokenType.Attribute;
            return this;
        }
        // normal attribute
        let qn = n;
        if (ns) {
            // treat ns as a namespace URI, not a prefix
            const p = this._ensurePrefixDeclared(ctx, ns);
            qn = `${p}:${n}`;
        }
        ctx.lastToken = TokenType.Attribute;
        this._writeAttStr(qn, v);
        return this;
    }
    /**
     *
     * @param ns
     * @param n
     * @returns
     */
    ele(ns, n) {
        const ctx = this._peekContext();
        if (ctx) {
            this._closeOpenTagIfNeeded(ctx);
        }
        let qns = n;
        if (ns) {
            const p = this._lookupPrefix(ns) ?? ns;
            qns = `${p}:${n}`;
        }
        this._pushContext(qns, ++this._d);
        this._w.write(XmlSyntax.OpenTag, qns);
        return this;
    }
    /**
     *
     * @param txt
     * @returns
     */
    text(txt) {
        const ctx = this._peekContext();
        if (!ctx) {
            throw new Error("text() without open element");
        }
        this._closeOpenTagIfNeeded(ctx);
        ctx.lastToken = TokenType.Text;
        this._w.write(this._escText(txt));
        return this;
    }
    /**
     *
     * @returns
     */
    end() {
        const ctx = this._popContext();
        if (ctx) {
            this._d--;
            if (!ctx.closed) {
                this._w.write(XmlSyntax.Slash, XmlSyntax.CloseTag);
            }
            else {
                this._w.write(XmlSyntax.OpenTag, XmlSyntax.Slash, ctx.name, XmlSyntax.CloseTag);
            }
        }
        return this;
    }
    _pushContext(name, depth) {
        const ctx = new XmlBuilder.Context(name, depth);
        this._ctxStack.push(ctx);
        return ctx;
    }
    _popContext() {
        return this._ctxStack.pop();
    }
    _peekContext() {
        return this._ctxStack[this._ctxStack.length - 1];
    }
    get _contextDepth() {
        return this._ctxStack.length;
    }
    _writeAttStr(name, value) {
        this._w.write(XmlSyntax.Space, name, XmlSyntax.Equal, XmlSyntax.Quote, this._escAttr(value), XmlSyntax.Quote);
    }
    _lookupPrefix(ns) {
        let i = this._ctxStack.length - 1;
        if (i >= 0) {
            do {
                const ctx = this._ctxStack[i--];
                const p = ctx.ns2prefix?.get(ns);
                if (p) {
                    return p;
                }
            } while (i >= 0);
        }
        return undefined;
    }
    _escText(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }
    _escAttr(s) {
        return this._escText(s).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
    }
    _isXmlnsDecl(ns, n) {
        if (ns) {
            return ns === XmlSyntax.Xmlns;
        }
        const l = n.length;
        const s = XmlSyntax.Xmlns.length;
        if (l >= s) {
            return n.startsWith(XmlSyntax.Xmlns) && (n.length == s || n[s] == XmlSyntax.Semicolon);
        }
        return false;
    }
    _registerNamespace(ctx, prefix, uri) {
        if (prefix === XmlSyntax.Xml || prefix === XmlSyntax.Xmlns) {
            throw new Error(`reserved prefix '${prefix}'`);
        }
        const existingUri = ctx.prefix2ns.get(prefix);
        if (existingUri && existingUri !== uri) {
            throw new Error(`prefix '${prefix}' already bound to a different namespace`);
        }
        const existingPrefix = ctx.ns2prefix.get(uri);
        if (!existingPrefix) {
            ctx.ns2prefix.set(uri, prefix);
        }
        ctx.prefix2ns.set(prefix, uri);
    }
    _allocPrefix(ctx) {
        let i = 1;
        while (true) {
            const p = `ns${i++}`;
            if (!ctx.prefix2ns.has(p)) {
                return p;
            }
        }
    }
    _ensurePrefixDeclared(ctx, uri) {
        const existing = this._lookupPrefix(uri);
        if (existing) {
            return existing;
        }
        if (ctx.closed) {
            throw new Error(`can not declare namespace after start tag closed for <${ctx.name}>`);
        }
        const prefix = this._allocPrefix(ctx);
        // write xmlns:prefix="uri" and register it
        this._writeAttStr(`${XmlSyntax.Xmlns}:${prefix}`, uri);
        this._registerNamespace(ctx, prefix, uri);
        return prefix;
    }
    _closeOpenTagIfNeeded(ctx) {
        if (!ctx.closed) {
            this._w.write(XmlSyntax.CloseTag);
            ctx.closed = true;
        }
    }
}
/** */
XmlBuilder.Context = class {
    /**
     *
     *@param name
     *@param depth
     */
    constructor(name, depth) {
        /** */
        this.name = "";
        /** */
        this.closed = false;
        /** */
        this.lastToken = null;
        // uri -> prefix
        this.ns2prefix = new Map();
        // prefix -> uri (for conflict checks)
        this.prefix2ns = new Map();
        // optional: default namespace uri
        this.defaultNs = null;
        this.name = name;
        this.depth = depth;
    }
};
//# sourceMappingURL=xml.builder.js.map
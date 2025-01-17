const userAgent = typeof window !== 'undefined' ? window.navigator.userAgent : 'no-window';
const isBot = /bot|crawler|spider|crawling/i.test(userAgent);

export class ServerStream {

    constructor(opts = {}) {
        let {
            method = 'PUT',
            url = '/log',
            throttleInterval = 3000,
            withCredentials = false,
            onError,
            flushOnClose = false,
            writeCondition = ServerStream.defaultWriteCondition,
        } = opts;

        this.writeCondition = writeCondition;
        this.records = {};

        this.start({ method, url, throttleInterval, withCredentials, onError });

        if (flushOnClose && typeof window.fetch !== 'undefined') {
            // TODO: look at page visibility api here
            // https://github.com/GoogleChromeLabs/page-lifecycle
            window.addEventListener('beforeunload', async () => {
                if (url.then) {
                    url = await url;
                }
                if (this.currentThrottleTimeout) {
                    window.clearTimeout(this.currentThrottleTimeout);
                }
                const recs = this.recordsAsArray();
                if (recs.length) {
                    // swapped sendBeacon for fetch as discussed here:
                    // https://stackoverflow.com/questions/55421459/http-request-beforeunload-sendbeacon-vs-img-src
                    window.fetch(url, {
                        method,
                        body: JSON.stringify(recs),
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        credentials: withCredentials ? 'include' : 'same-origin',
                        mode: 'cors',
                        keepalive: true,
                    });
                }
            }, false);
        }
    }

    async start({ method, url, throttleInterval, withCredentials, onError }) {
        if (url.then) {
            url = await url;
        }
        
        const throttleRequests = () => {
            // wait for any errors to accumulate
            this.currentThrottleTimeout = setTimeout(() => {
                const recs = this.recordsAsArray();
                if (recs.length) {
                    const xhr = new XMLHttpRequest();
                    xhr.onreadystatechange = () => {
                        if (xhr.readyState === XMLHttpRequest.DONE) {
                            if (xhr.status >= 400) {
                                if (typeof onError === 'function') {
                                    onError.call(this, recs, xhr);
                                } else {
                                    console.warn('Browser Bunyan: A server log write failed');
                                }
                            }
                            this.records = {};
                            throttleRequests();
                        }
                    };
                    xhr.open(method, url);
                    xhr.setRequestHeader('Content-Type', 'application/json');
                    xhr.withCredentials = withCredentials;
                    xhr.send(JSON.stringify(recs));
                } else {
                    throttleRequests();
                }
            }, throttleInterval);
        };

        throttleRequests();
    }

    stop() {
        setTimeout(() => {
            if (this.currentThrottleTimeout) {
                clearTimeout(this.currentThrottleTimeout);
                this.currentThrottleTimeout = null;
            }
        }, 1);
    }

    async write(rec) {
        rec.url = typeof window !== 'undefined' && window.location.href;
        rec.userAgent = userAgent;
        
        for (const [key, value] of Object.entries(rec)) {
          if (!value.then) continue;
          rec[key] = await value;
        }
         
        if (this.currentThrottleTimeout && this.writeCondition(rec)) {
            if (this.records[rec.msg]) {
                this.records[rec.msg].count++;
            } else {
                rec.count = 1;
                this.records[rec.msg] = rec;
            }
        }
    }

    recordsAsArray() {
        return Object.keys(this.records).map(errKey => this.records[errKey]);
    }

    static defaultWriteCondition() {
        return window.navigator.onLine && !isBot;
    }
}

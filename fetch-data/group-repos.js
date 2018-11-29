const fs = require('fs'),
      config = require('../config.json'),
      Queue = require('promise-queue'),
      parse = require('parse-link-header'),
      request = require('request');

var queue = new Queue(Infinity, 1);
var retryAfter = 0;

const ghCache = {};

const httpIze = u => u.replace(/^https:/, 'http:');

const queueGhRequest = function(url) {
    return queue.add(function() {
        return new Promise(function (resolve, reject) {
            if (ghCache[url]) {
                if (ghCache[url].nextPage) {
                    return queueGhRequest(ghCache[url].nextPage).then(obj => resolve(ghCache[url].responseObject.concat(obj))).catch(reject);
                } else {
                    return resolve(ghCache[url].responseObject);
                }
            }
            setTimeout(function() {
                request({
                    method: 'GET',
                    url: url,
                    headers: {
                        'User-Agent': 'W3C spec dashboard https://github.com/w3c/spec-dashboard',
                        'Authorization': 'token ' + config.ghapitoken
                    }
                }, function (error, response, body) {
                    const ret = {};
                    if (error) return reject(error);
                    if (response.headers['retry-after']) {
                        retryAfter = response.headers['retry-after'];
                    }
                    if (response.statusCode == 403 && response.headers['retry-after']) {
                        // requeue for later
                        return queueGhRequest(url);
                    } else if (response.statusCode > 400) reject({status: response.statusCode, body: body});
                    let obj = [];
                    if (body) {
                        try {
                            obj = JSON.parse(body);
                        } catch (e){
                            reject(e);
                        }
                    }
                    ret.responseObject = obj;
                    if (response.headers['link']) {
                        const parsed = parse(response.headers['link']);
                        if (parsed.next) {
                            ret.nextPage = parsed.next.url;
                        }
                    }
                    ghCache[url] = ret;
                    if (ret.nextPage) {
                        queueGhRequest(ret.nextPage).then(obj => resolve(ret.responseObject.concat(obj))).catch(reject);
                    } else {
                        resolve(ret.responseObject);
                    }
                });
            }, retryAfter*1000);
        });
    });
};

const urlToGHRepo = (url = "", tr_shortname) => {
    const nofilter = x => true;

    const versionless = s => s.replace(/-[0-9]*$/,'');
   const cssIssueFilter = shortname => x => {
       return x.title.match(new RegExp("\\[" + versionless(shortname) + "\\]"))
              || x.title.match(new RegExp("\\[" + shortname + "\\]"))
              || x.title.match(new RegExp("\\[" + tr_shortname + "\\]"))
              || x.title.match(new RegExp("\\[" + versionless(tr_shortname) + "\\]"));
   };

    const githubio = url.match(/^https?:\/\/([^\.]*)\.github\.io\/([^\/]*)\/?/);
    if (githubio) {
        return {owner: githubio[1], name: githubio[2], issuefilter: nofilter};
    }
    const githubcom = url.match(/^https:\/\/github.com\/([^\/]*)\/([^\/]*)\//);
    if (githubcom) {
        return {owner: githubcom[1], name: githubcom[2], issuefilter: nofilter};
    }
    const rawgit = url.match(/^https?:\/\/rawgit.com\/([^\/]*)\/([^\/]*)/);
    if (rawgit) {
        return {owner: rawgit[1], name: rawgit[2], issuefilter: nofilter};
    }
    const whatwg = url.match(/https:\/\/([^\.]*).spec.whatwg.org\//);
    if (whatwg) {
        return {owner: "whatwg", name: whatwg[1], issuefilter: nofilter};
    }

    const csswg = url.match(/^https?:\/\/drafts.csswg.org\/([^\/]*)\/?/);
    if (csswg) {
        return {owner: 'w3c', name: 'csswg-drafts', issuefilter: cssIssueFilter(csswg[1])};
    }
    const devcss = url.match(/^https?:\/\/dev.w3.org\/csswg\/([^\/]*)\/?/);
    if (devcss) {
        return {owner: 'w3c', name: 'csswg-drafts', issuefilter: cssIssueFilter(devcss[1])};
    }
    const devfxtf = url.match(/^https?:\/\/dev.w3.org\/fxtf\/([^\/]*)\/?/);
    if (devfxtf) {
        return {owner: 'w3c', name: 'fxtf-drafts', issuefilter: cssIssueFilter(devfxtf[1])};
    }
    const ghfxtf = url.match(/^https:\/\/drafts.fxtf.org\/([^\/]*)\/?/);
    if (ghfxtf) {
        return {owner: 'w3c', name: 'fxtf-drafts', issuefilter: cssIssueFilter(ghfxtf[1])};
    }
    const houdini = url.match(/^https:\/\/drafts.css-houdini.org\/([^\/]*)\/?/);
    if (houdini) {
        return {owner: 'w3c', name: 'css-houdini-drafts', issuefilter: cssIssueFilter(houdini[1])};
    }

    const svgwg = url.match(/^https?:\/\/svgwg.org\/specs\/([^\/]*)\/?/);
    if (svgwg) {
        return {owner: 'w3c', name: 'svgwg', issuefilter: x => x.labels.map(l => l.name.toLowerCase()).indexOf("svg " + svgwg[1]) !== -1};
    }
    // Specific cases
    if (url === "https://svgwg.org/svg2-draft/") {
        return {owner: 'w3c', name: 'svgwg', issuefilter: x => x.labels.map(l => l.name.toLowerCase()).indexOf("svg core") !== -1};
    }
    if (url === "https://linkedresearch.org/ldn/") {
        return {owner: 'w3c', name: 'ldn', issuefilter: nofilter};
    }
    if (url === "https://micropub.net/draft/") {
        return {owner: 'w3c', name: 'micropub', issuefilter: nofilter};
    }
    if (url === "https://webmention.net/draft/") {
        return {owner: 'w3c', name: 'webmention', issuefilter: nofilter};
    }
    if (url === "http://dev.w3.org/2009/dap/camera/") {
        return {owner: 'w3c', name: 'html-media-capture', issuefilter: nofilter};
    }
};


fs.readFile("./groups.json", (err, data) => {
    if (err) return console.error(err);
    const groups = JSON.parse(data);

    const updateIssues = process.argv[2] == "--update-issues";

    fs.writeFileSync("./pergroup/repo-update.json", JSON.stringify(new Date()));

    Object.keys(groups).forEach(wgid => {
        fs.readFile("./pergroup/" + wgid + ".json", (err, data) => {
            const specs = JSON.parse(data);
            Promise.all(
                specs.map(s => Object.assign({}, s, {repo: urlToGHRepo(s.editorsdraft, s.shortname)}))
                    .filter(s => s.repo)
                    .map(s => {
                        const hash = {}
                        hash[s.shortlink] = {repo: s.repo, recTrack: s.versions[0]['rec-track']};
                        if (updateIssues) {
                            return queueGhRequest('https://api.github.com/repos/' + s.repo.owner + '/' + s.repo.name + '/issues?state=all&per_page=100')
                                .then(issues => {
                                    hash[s.shortlink]["issues"] = issues.filter(s.repo.issuefilter)
                                        .map(i => {
                                     return {state: i.state, number: i.number, created_at: i.created_at, closed_at: i.closed_at, title: i.title, labels: i.labels, assignee: i.assignee ? i.assignee.login: null, isPullRequest: i.pull_request !== undefined};
                                        });
                                    return hash;
                                }).catch(console.error.bind(console));
                        } else {
                            // we re-use the previously fetched issues
                            return new Promise((res, rej) => {
                                fs.readFile("./pergroup/" + wgid + "-repo.json", (err, data) => {
                                    if (err) return rej(err);
                                    const repos = JSON.parse(data);
                                    hash[s.shortlink].issues = (repos[s.shortlink] || repos[httpIze(s.shortlink)] || {}).issues ;
                                    res(hash);
                                });
                            });
                        }
                    })
            ).then(repoHashList => {
                const repoSpecs = repoHashList.reduce(
                    (a,b) => {a[Object.keys(b)[0]] = b[Object.keys(b)[0]]; return a;},
                    {});
                fs.writeFileSync("./pergroup/" + wgid + "-repo.json", JSON.stringify(repoSpecs,null, 2));
            }).catch(console.error.bind(console));
        });
    });
});

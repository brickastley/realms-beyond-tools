// ==UserScript==
// @name	Realms Beyond Mafia Helper
// @namespace realmsbeyond
// @description	Allows you to filter threads on poster and perform automatic votecounts
// @include	http://realmsbeyond.net/forums/*
// @include	https://realmsbeyond.net/forums/*
// @include	http://www.realmsbeyond.net/forums/*
// @include	https://www.realmsbeyond.net/forums/*
// @include	http://forums.totalwar.org/*
// @grant GM_getValue
// @grant GM_setValue
// @grant GM_deleteValue
// @grant GM_log
// ==/UserScript==

// Check compatibility:
var notSupported = false;
var isVBulletin = false;
var postsByPostId = {};

try {
	if (!this.GM_getValue || (this.GM_getValue.toString && this.GM_getValue.toString().indexOf("not supported")>-1)) {
		notSupported = true;
	}
}
catch(err) {
	notSupported = true;
}
if (notSupported) {
    this.GM_getValue=function (key,def) {
        return localStorage[key] || def;
    };
    this.GM_setValue=function (key,value) {
        return localStorage[key]=value;
    };
    this.GM_deleteValue=function (key) {
        return delete localStorage[key];
    };
}

function xpath(path, root)
{
    if (!root)
        root = document;
    var result = document.evaluate(path, root, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  	console.log(result);
    var nodes = [];
    for (var i = 0; i < result.snapshotLength; i++) {
        nodes[i] = result.snapshotItem(i);
    }
  	console.log(nodes);
    return nodes;
}

function xpath1(path, root)
{
    var nodes = xpath(path, root);
    if (nodes.length < 1)
		return undefined;
    return nodes[0];
}

var _currentThreadId = null;
function getCurrentThreadId() {
	if(_currentThreadId) return _currentThreadId;
    var threadId = "t0";
    var url = window.location.toString();
    if (url.match(/showthread\.php.*(\?|\&)tid=(\d+)/)) {			
        threadId = "t" + RegExp.$2;
    }
    else if (url.match(/showthread\.php\?(\d+)/)) {			
        threadId = "t" + RegExp.$1;
    }
	_currentThreadId = threadId;
    return threadId;
}

function _countVote(postNode, voteSpan, votesByPostNumber, aliases, colorFunction, voteType) {
	if(!colorFunction || (voteSpan.style && colorFunction(voteSpan.style.color))) {
		var votee = (voteSpan.innerText || voteSpan.textContent).trim().replace(/\s/g," ").replace(/'/g,"").replace(/\s*[:,;]+\s*/g,":");
        console.log("Votee: " + votee);
		if(isVBulletin) {
			if(votee.toUpperCase() == "UNVOTE" || votee.toUpperCase().startsWith("UNVOTE:") || votee.toUpperCase().startsWith("UNVOTE ")) {
				votee = " " + votee.substring(7).trim();
				var idx = Math.max(votee.toUpperCase().indexOf(":VOTE:"), votee.toUpperCase().indexOf(" VOTE:"), votee.toUpperCase().indexOf(":VOTE "), votee.toUpperCase().indexOf(" VOTE "));
				if(idx >= 0)
					votee = votee.substring(idx+1);
				else
					votee = "Vote: Unvote";
			}
			if(!votee.toUpperCase().startsWith("VOTE:") && !votee.toUpperCase().startsWith("VOTE ")) return;
			votee = votee.substring(5).trim();
		}
		votee = getCanonicalPlayerName(votee, aliases);
		var post = getPost(postNode);
		votesByPostNumber["p" + post.postNumber] = votesByPostNumber["p" + post.postNumber] || [];
		votesByPostNumber["p" + post.postNumber].push({voterId: post.userId, voter: post.userName, votee: votee, postId: post.id, voteType: voteType});
		//console.log("Post " + post.postNumber + " User " + post.userName + " (" + post.userId + ") votes " + votee);
        return true;
	}
    return false;
}

function _countVoteRecursively(postNode, voteSpan, votesByPostNumber, aliases, colorFunction) {
    var child = voteSpan.firstElementChild || voteSpan.firstChild || null;
    if(!(child && child.nodeName == "SPAN" && _countVoteRecursively(postNode, child, votesByPostNumber, aliases))) {
		if(isVBulletin) {
			_countVote(postNode, voteSpan, votesByPostNumber, aliases, null, "Bold");
		}
		else {
			_countVote(postNode, voteSpan, votesByPostNumber, aliases, isColorReddish, "Red");
			_countVote(postNode, voteSpan, votesByPostNumber, aliases, isColorGreenish, "Green");
		}
    }
}

function getCanonicalPlayerName(alias, aliasLists) {
	var lowerCaseAlias = alias.toLowerCase();
	for(var a = 0; a < aliasLists.length; a++) {
		var aliases = aliasLists[a];
		for(var b = 0; b < aliases.length; b++) {
			if(aliases[b].toLowerCase() == lowerCaseAlias) {
				return aliases[0];
			}
		}
	}
	return alias;
}

function addAliases(aliasLists, aliasTexts) {
    //console.log("Processing aliases: ");
    //console.dir(aliasTexts);
	for(var a = 0; a < aliasLists.length; a++) {
		var aliases = aliasLists[a];
        var newAliases = [];
        for(var c = 0; c < aliasTexts.length; c++) {
            var knownAlias = false;
    		for(var b = 0; b < aliases.length; b++) {
				if(aliases[b].toLowerCase() == aliasTexts[c].toLowerCase())
                    knownAlias = true;
			}
            if(!knownAlias) {
                newAliases.push(aliasTexts[c]);
            }
		}
        if(newAliases.length < aliasTexts.length) {
            // Merge alias list with existing alias list
            aliases = aliases.concat(newAliases);
            aliasLists[a] = aliases;
            return;
        }
	}
    // New alias list
	aliasLists.push(aliasTexts);
}

function findAliases(threadId, filters) {
	filters[threadId].aliases = filters[threadId].aliases || [];
    var aliasNodes = isVBulletin ? xpath("//div[contains(@class, 'postbody')]/div/div/div/blockquote/ul/li") : xpath("//tr/td/div[contains(@class, 'post_body')]/ul/li").concat(xpath("//tr/td/div[contains(@class, 'post_body')]/span/ul/li"));
    if(aliasNodes) for(var v = 0; v < aliasNodes.length; v++) {
        try {
            var aliasNode = aliasNodes[v];
			var aliasTexts = (aliasNode.innerText || aliasNode.textContent).trim().replace(/'/g, "").split(" alias ");
			if(aliasTexts.length > 1) {
				addAliases(filters[threadId].aliases, aliasTexts);
			}
        }
        catch(err) {
            console.log("Error processing potential alias " + v + ": " + err);
        }
    }
	console.log("Alias lists:");
	console.dir(filters[threadId].aliases);
    setThreadFilters(filters);
}

function countVotes(threadId, filters) {
	var aliases = filters[threadId].aliases || [];
    var votesByPostNumber = {};
    var votes = isVBulletin ? [].concat(xpath("//div[contains(@class, 'postbody')]/div/div/div/blockquote/b"), xpath("//div[contains(@class, 'postbody')]/div/div/div/blockquote/font")) : xpath("//tr/td/div[contains(@class, 'post_body')]/span");
    console.log("Counting votes. Found " + (votes ? votes.length : null) + " potential votes.");
    if(votes) for(var v = 0; v < votes.length; v++) {
        try {
            var voteSpan = votes[v];
            //if(voteSpan.style && voteSpan.style.color) console.log(voteSpan.style.color);
			var postNode = voteSpan.parentNode.parentNode.parentNode.parentNode.parentNode;
            _countVoteRecursively(postNode, voteSpan, votesByPostNumber, aliases);
        }
        catch(err) {
            console.log("Error processing potential vote " + v + ": " + err);
        }
    }
    if(!(filters[threadId] && filters[threadId].votes && filters[threadId].votes.countVotes)) return votesByPostNumber;
	filters[threadId].votes.votesByPostNumber = filters[threadId].votes.votesByPostNumber || {};
    for(var postId in votesByPostNumber) {
        filters[threadId].votes.votesByPostNumber[postId] = votesByPostNumber[postId];
    }
    setThreadFilters(filters);
    return votesByPostNumber;
}

function _countQuotes(xpathExpression, result) {
    var quotes = xpath(xpathExpression);
    //console.log("Counting quotes. Found " + (quotes ? quotes.length : null) + " potential quotes.");
    if(quotes) for(var v = 0; v < quotes.length; v++) {
        try {
            var quote = quotes[v];
            var quotee = null;
            if(quote.firstChild.tagName == "SPAN")
            	quotee = quote.firstChild.nextSibling.nodeValue; // quote.innerText || quote.textContent;
            else
                quotee = quote.innerText || quote.textContent;
            quotee = quotee.replace(" Wrote:", "").trim();
            if(quotee == "Quote:") quotee = "unknown";
            var postTable = quote;
            while(postTable.tagName != "TABLE" && postTable.parentNode) {
                postTable = postTable.parentNode;
            }
            if(postTable.parentNode) {
                var post = getPost(postTable);
                result["p" + post.postNumber] = result["p" + post.postNumber] || [];
                result["p" + post.postNumber].push({quoterId: post.userId, quoter: post.userName, quotee: quotee});
                //console.log("Post " + post.postNumber + " User " + post.userName + " (" + post.userId + ") quotes " + quotee);
            }
        }
        catch(err) {
            console.log("Error processing quote " + v + ": " + err);
        }
    }
}

function countQuotes(quotes) {
    return _countQuotes("//tr/td/div[contains(@class, 'post_body')]/blockquote/cite", quotes);
}

function countSpoileredQuotes(quotes) {
    return _countQuotes("//tr/td/div[contains(@class, 'post_body')]/div/div[contains(@class, 'quotecontent')]/div/blockquote/cite", quotes);
}

function getPost(postTable) {
	if(isVBulletin) return getVBulletinPost(postTable);
	if (!postTable || postTable.nodeName != "DIV") { console.log("error 11"); return null; }
	var post = {
		table: postTable,
		id: postTable.id.replace("post_", "")*1,
		headerCell: postTable.children[0].children[0].children[0],
        titleRow: postTable.children[0].children[0],
        avatarRow: postTable.children[0],
        postRow: postTable.children[1],
        buttonRow: postTable.children[2],
		postRows: [],
		menu: null
	};
    var userAnchor = post.avatarRow.children[0].children[0].children[0].children[0];
	post.userName = userAnchor.innerText ? userAnchor.innerText : userAnchor.textContent;
	post.userId = post.userName;
	var href = userAnchor.getAttribute("href");
	if (href.match(/member\.php.*(\?|\&)uid=(\d+)/)) {			
		post.userId = RegExp.$2;
	}
	post.postRows.push(post.avatarRow);
	post.postRows.push(post.postRow);
	post.postRows.push(post.buttonRow);
	post.titleDiv = post.headerCell.firstElementChild || post.headerCell.firstChild;
	var postNumberDiv = post.headerCell.children[0];
	var postNumberLink = postNumberDiv.children[0];
	post.postNumber = (postNumberLink.innerText || postNumberLink.textContent).replace("#", "")*1;
	post.menu = document.getElementById(postTable.id + "_mafiamenu");
	if(!post.menu) {
		post.menu = document.createElement("div");
		post.menu.id = postTable.id + "_mafiamenu";
		post.menu.style.float = "left";
		post.menu.style.width = "auto";
		post.menu.style.verticalAlign = "top";
		post.menu.innerHTML = '<span class="smalltext" id="' + postTable.id + '_postInfo"></span>&nbsp;&nbsp;';
		post.headerCell.insertBefore(post.menu, post.titleDiv);
	}
	post.postInfo = document.getElementById(postTable.id + "_postInfo");
	return post;
}

function getVBulletinPost(postTable) {
	if (!postTable || !postTable.parentNode || !postTable.parentNode.parentNode) { console.log("error 11"); return null; }
	postTable = postTable.parentNode.parentNode;
	var post = {
		table: postTable,
		id: postTable.id.replace("post_", "")*1,
		headerCell: postTable.children[0],
        titleRow: postTable.children[0],
        avatarRow: postTable.children[1].children[0],
        postRow: postTable.children[1].children[1],
        buttonRow: postTable.children[2],
		postRows: [],
		menu: null
	};
    var userAnchor = post.avatarRow.children[0].children[0].children[0];
	post.userName = userAnchor.children[0].children[0].innerText ? userAnchor.children[0].children[0].innerText : userAnchor.children[0].children[0].textContent;
	post.userId = post.userName;
	var href = userAnchor.getAttribute("href");
	if (href.match(/member\.php\?(\d+)-/)) {			
		post.userId = RegExp.$1;
	}
	post.postRows.push(post.avatarRow);
	post.postRows.push(post.postRow);
	post.postRows.push(post.buttonRow);
	post.titleDiv = post.headerCell.firstElementChild || post.headerCell.firstChild;
	var postNumberDiv = post.headerCell.lastElementChild || post.headerCell.lastChild;
	var postNumberLink = postNumberDiv.children[0];
	post.postNumber = (postNumberLink.innerText || postNumberLink.textContent).replace("#", "")*1;
	post.menu = document.getElementById(postTable.id + "_mafiamenu");
	if(!post.menu) {
		post.menu = document.createElement("div");
		post.menu.id = postTable.id + "_mafiamenu";
		post.menu.style.float = "left";
		post.menu.style.width = "auto";
		post.menu.style.verticalAlign = "top";
		post.menu.innerHTML = '<span class="smalltext" id="' + postTable.id + '_postInfo"></span>&nbsp;&nbsp;';
		post.headerCell.insertBefore(post.menu, post.titleDiv);
	}
	post.postInfo = document.getElementById(postTable.id + "_postInfo");
	return post;
}

function joinObjects(objects, fieldName, separator, transform) {
    var result = "";
    for(var v = 0; v < objects.length; v++) {
        if(v > 0) result += (separator || ", ");
        result += transform ? transform(objects[v]) : objects[v][fieldName];
    }
    return result;
}

function getPosts() {
	var posts = [];
    var r = isVBulletin ? xpath("//li[contains(@class, 'postcontainer')]/div[contains(@class, 'postdetails')]/div[contains(@class, 'userinfo')]") : xpath("//div[contains(@class, 'author_information')]");
    if (!r) { console.log("error 10"); return []; }
    for (var i = 0; i < r.length; i++) {
        var postTable = isVBulletin ? r[i] : r[i].parentNode.parentNode;
		var post = getPost(postTable);
		posts.push(post);
	}
	return posts;
  console.log(posts);
}

function fixThreadDisplay(filters)
{
    var threadId = getCurrentThreadId();
	var posts = getPosts();
	for(var i = 0; i < posts.length; i++) {
		var post = posts[i];
		postsByPostId[post.id] = post;
	}
    if(!filters[getCurrentThreadId()].isEnabled) {
        for (var i = 0; i < posts.length; i++) {
            var post = posts[i];
            for(var k = 0; k < post.postRows.length; k++) {
                post.postRows[k].style.display = "";
            }
            post.menu.parentNode.removeChild(post.menu);
            post.menu = null;
        }
        return;
    }
    updatePosters(filters, posts);
	findAliases(threadId, filters);
    var votesByPostNumber = countVotes(threadId, filters);
    var quotesByPostNumber = {};
    countQuotes(quotesByPostNumber);
    countSpoileredQuotes(quotesByPostNumber);
    for (var i = 0; i < posts.length; i++) {
		var post = posts[i];
        var show = !isUserFiltered(filters, threadId, post.userId);
        var isolated = isUserIsolated(filters, threadId, post.userId);
		var isAnyUserIsolated = isUserIsolated(filters, threadId, null);
        for(var k = 0; k < post.postRows.length; k++) {
            post.postRows[k].style.display = ((isAnyUserIsolated && isolated) || (!isAnyUserIsolated && show)) ? "" : "none";
        }
		var postInfo = null;
		if(votesByPostNumber["p" + post.postNumber] && votesByPostNumber["p" + post.postNumber].length > 0) {
			postInfo = post.userName + " votes " + joinObjects(votesByPostNumber["p" + post.postNumber], "votee", ", ", function(vote) { return "<span style='color: " + (vote.voteType || "#FF0000") + "'>" + vote.votee + "</span>"; });
		}
		if(quotesByPostNumber["p" + post.postNumber] && quotesByPostNumber["p" + post.postNumber].length > 0) {
			if(postInfo)
				postInfo += " and";
			else
				postInfo = post.userName;
			postInfo += " quotes " + joinObjects(quotesByPostNumber["p" + post.postNumber], "quotee", ", ");
		}
		if(postInfo == null) postInfo = "Post by " + post.userName;
		post.postInfo.innerHTML = postInfo;
        if (show) {
            var expandCollapse = createOrUpdateLink(post.menu, "_expandCollapse", "-", "#ff7777", "Hide this post", post.id, togglePost);
            var toggleFilterLink = createOrUpdateLink(post.menu, "_toggleFilter", "x", "#ff7777", "Hide all posts by "+post.userName, post.userId, toggleFilter);
        }
        else {
            var expandCollapse = createOrUpdateLink(post.menu, "_expandCollapse", "+", "#77ff77", "Show this post", post.id, togglePost);
            var toggleFilterLink = createOrUpdateLink(post.menu, "_toggleFilter", "v", "#77ff77", "Show all posts by "+post.userName, post.userId, toggleFilter);
        }
		if(isolated) {
			var isolateLink = createOrUpdateLink(post.menu, "_isolate", "(x)", "#ff7777", "No longer show this user exclusively", post.userId, toggleIsolation);
		}
		else {
			var isolateLink = createOrUpdateLink(post.menu, "_isolate", "(&nbsp;)", "#77ff77", "Show this user exclusively", post.userId, toggleIsolation);
		}
		if(filters[threadId].votes && filters[threadId].votes.countVotes && filters[threadId].votes.dayStarts.indexOf(post.postNumber) >= 0) {
			var dayStartLink = createOrUpdateLink(post.menu, "_dayStart", "Remove day start", "#ff7777", "Remove the day start from this post", post.postNumber, toggleDayStart);
		}
		else {
			var dayStartLink = createOrUpdateLink(post.menu, "_dayStart", "Start new day", "#77ff77", "Start a new vote count from this post", post.postNumber, toggleDayStart);
		}
	}
	if(filters[threadId].votes && filters[threadId].votes.countVotes) {
        // Register no votes for all posts in current page that have no counted votes
		for (var i = 0; i < posts.length; i++) {
			filters[threadId].votes.votesByPostNumber["p" + posts[i].postNumber] = filters[threadId].votes.votesByPostNumber["p" + posts[i].postNumber] || [];
        }
	    setThreadFilters(filters);
        // Compile tallies for all posts in current page
		for (var i = 0; i < posts.length; i++) {
			var redTally = compileTally(filters, posts[i], isVBulletin ? "Bold": "Red", "Lynch votes");
			var greenTally = isVBulletin ? null : compileTally(filters, posts[i], "Green", "Green votes");
			var t = document.getElementById(posts[i].menu.id + "_tally");
			if(!t) {
				posts[i].tallyDiv = document.createElement("div");
				posts[i].tallyDiv.id = posts[i].menu.id + "_tally";
				posts[i].tallyDiv.style.float = "left";
				posts[i].tallyDiv.style.width = "auto";
				posts[i].tallyDiv.style.verticalAlign = "top";
                posts[i].tallyDiv.style.marginRight = "2em";
				posts[i].tallyDiv.innerHTML = (redTally || greenTally) ? "Vote tally" : "No tally available";
				posts[i].headerCell.insertBefore(posts[i].tallyDiv, posts[i].titleDiv);
				t = posts[i].tallyDiv;
			}
			if(redTally || greenTally) {
                //console.log("Tally for post " + posts[i].postNumber + ": " + createTallyText(tally));
				//t.innerHTML = "<a href=\"newreply.php?tid=" + threadId.substring(1) + "&amp;replyto=" + posts[i].id + "\"><span style=\"margin-right: 1em;\" title=\"" + createTallyText(tally) + "\">Vote tally</span></a>";
                var tallyText = (redTally ? (redTally.header + ":\n" + createTallyText(redTally.tally) + "\n") : "") + (greenTally ? (greenTally.header + ":\n" + createTallyText(greenTally.tally)) : "");
                var tallyPostTitle = "Tally as of post " + posts[i].postNumber;
                var tallyPost = tallyPostTitle + ":\n\n" + createTallyPost([redTally, greenTally]);
                var form = createPreviewForm(posts[i].id, tallyPostTitle, tallyPost, "Post tally");
                t.innerHTML = form;
                t.setAttribute("title", tallyText);
			}
            else {
				t.innerHTML = "No tally available";
                t.setAttribute("title", "To have Mafia Helper automatically compile tallies for you, navigate through all the thread's pages, and also mark off day starts.");
                //console.log("No tally available for post " + posts[i].postNumber + ".");
            }
		}
	}
}

function createVBulletinPreviewForm(postId, subject, message, buttonText) {
    var threadId = getCurrentThreadId().substring(1);
    var form = "<form action=\"newreply.php?do=postreply&t=" + threadId + "\" method=\"post\" enctype=\"multipart/form-data\" name=\"preview_" + postId + "\">";
    var parameters = {
        "title": subject,
        "iconid": 0,
        "message_backup": message,
        "message": message,
        "do": "postreply",
		"p": postId,
		"poststarttime": (new Date).getTime(),
        //"posthash": "18c4db52b73c602f164deb17cc0391ee",
        "t": threadId,
		"multiquoteempty": "only",
		"preview": "Preview Post",
		"parseurl": 1,
		"htmlstate": "on_nl2br",
		"wysiwyg": 0,
		"s": "",
		"securitytoken": SECURITYTOKEN,
		//"loggedinuser": 100369,
		"specifiedpost": 1
    };
    for(var key in parameters) {
        form += "<input type=\"hidden\" name=\"" + key + "\" value=\"" + parameters[key] + "\">";
    }
    form += "<input type=\"submit\" class=\"button\" style=\"margin: 0em; height: 16px; font-size: 8px;\" name=\"previewpost\" value=\"" + buttonText + "\"></form>";
    return form;
}

function createPreviewForm(postId, subject, message, buttonText) {
	if(isVBulletin) return createVBulletinPreviewForm(postId, subject, message, buttonText);
    var threadId = getCurrentThreadId().substring(1);
    var form = "<form action=\"newreply.php?tid=" + threadId + "&amp;processed=1\" method=\"post\" enctype=\"multipart/form-data\" name=\"preview_" + postId + "\">";
    var parameters = {
        //"my_post_key": "8416835c8fb0fabc9e1221ae6e6c3bca",
        "subject": subject,
        "icon": "-1",
        "message_new": "",
        "message": message,
        "action": "do_newreply",
        "replyto": postId,
        //"posthash": "a3ffaf71dcac54f4e29130281581d038",
        "attachmentaid": "",
        "attachmentact": "",
        "quoted_ids": postId,
        "tid": threadId
    }
    for(var key in parameters) {
        form += "<input type=\"hidden\" name=\"" + key + "\" value=\"" + parameters[key] + "\">";
    }
    form += "<input type=\"hidden\" name=\"postoptions[signature]\" value=\"1\">";
    form += "<input type=\"hidden\" name=\"postoptions[subscriptionmethod]\" value=\"none\">";
    form += "<input type=\"submit\" class=\"button\" style=\"margin: 0em; height: 16px; font-size: 8px;\" name=\"previewpost\" value=\"" + buttonText + "\"></form>";
    return form;
}

function createTallyText(tally) {
    if(!tally || tally.length == 0) return "No votes.\n";
	var text = "";
	for(var i = 0; i < tally.length; i++) {
		var t = tally[i];
		if(t) {
			text += t.count + " votes: " + t.votee + " (" + joinObjects(t.voters, "voter", ", ") + ")\n";
		}
	}
	return text;
}

function createTallyPost(tallies) {
    if(!tallies || tallies.length == 0) return "No votes.\n";
	var text = "";
	var forumUrl = window.location.toString();
	forumUrl = forumUrl.substring(0,forumUrl.indexOf("showthread.php"))
    for(var j = 0; j < tallies.length; j++) {
        var tally = tallies[j];
		if(tally) {
			text += "[B]" + (tally.header || "Lynch votes") + "[/B]\n";
			if (!tally.tally || tally.tally.length == 0) {
				text += "No votes.\n\n";
			}
			else {
				for(var i = 0; i < tally.tally.length; i++) {
					var t = tally.tally[i];
					text += t.count + " votes: " + t.votee + " (" + joinObjects(t.voters, null, ", ", function(vote) {
						if(vote.postId)
							return isVBulletin ? 
									("[url=" + forumUrl + "showthread.php?" + getCurrentThreadId().substring(1) + "&p=" + vote.postId + "#post" + vote.postId + "]" + vote.voter + "[/url]") :
									("[url=" + forumUrl + "showthread.php?tid=" + getCurrentThreadId().substring(1) + "&pid=" + vote.postId + "#pid" + vote.postId + "]" + vote.voter + "[/url]");
						else
							return vote.voter;
					}) + ")\n";
				}
				if(isVBulletin)
					text += "\nVoting history:[SPOILER]" + joinObjects(tally.history, null, "\n", function(vote) {
						return "[quote=" + vote.voter + (vote.postId ? (";" + vote.postId): "") + "][color=" + (vote.voteType || "#FF0000") + "]" + vote.votee + "[/color][/quote]";
					}) + "[/SPOILER]\n\n";
				else
					text += "\nVoting history:[SPOILER]" + joinObjects(tally.history, null, "\n", function(vote) {
						return "[quote='" + vote.voter + "'" + (vote.postId ? " pid='" + vote.postId + "'" : "") + "][color=" + (vote.voteType || "#FF0000") + "]" + vote.votee + "[/color][/quote]";
					}) + "[/SPOILER]\n\n";
			}
		}
    }
	return text;
}

function compileTally(filters, post, voteType, header) {
    var tally = {}, history = [];
    var threadId = getCurrentThreadId();
	if(!filters[threadId] || !filters[threadId].votes) return;
	var votes = filters[threadId].votes;
	if(!votes.countVotes || !votes.dayStarts || votes.dayStarts.length == 0) return;
	for(var startDay = post.postNumber; startDay > 0 && votes.dayStarts.indexOf(startDay) == -1; startDay--);
    //console.log("Tally start day: " + startDay);
	if(startDay < 1) return null;
	for(var day = startDay; day <= post.postNumber; day++) {
		var dayVotes = votes.votesByPostNumber["p" + day];
        if(!dayVotes) {
            console.log("No votes found for post " + day);
            return null;
        }
        var filteredVotes = [];
        for(var i = 0; i < dayVotes.length; i++) {
                if(!voteType || dayVotes[i].voteType == voteType) {
                    filteredVotes.push(dayVotes[i]);
                    history.push(dayVotes[i]);
                }
        }
        dayVotes = filteredVotes;
		if(dayVotes.length > 0) {
			var vote = dayVotes[dayVotes.length-1];
			for(var votee in tally) {
				var existingVoteIndex = -1;
				for(var i = 0; i < tally[votee].length; i++) {
					if(tally[votee][i].voterId == vote.voterId)
						existingVoteIndex = i;
				}
				if(existingVoteIndex > -1) tally[votee].splice(existingVoteIndex, 1);
			}
			tally[vote.votee.toLowerCase()] = tally[vote.votee.toLowerCase()] || [];
			tally[vote.votee.toLowerCase()].push({
                votee: vote.votee,
				voterId: vote.voterId,
				voter: vote.voter,
				postNumber: day,
                postId: vote.postId
			});
		}
	}
    var result = { history: history, tally: [], header: header };
	for(var votee in tally) {
        if(tally[votee].length > 0) {
			var tallyLine = { votee: tally[votee][0].votee, count: tally[votee].length, voters: tally[votee] };
			result.tally.push(tallyLine);
        }
	}
	result.tally = result.tally.sort(function(a, b) { return b.count - a.count; });
	return result;
}

function toggleDayStart(linkNode, postNumber) {
    postNumber = postNumber * 1;
    var filters = getThreadFilters();
	var threadId = getCurrentThreadId();
    filters[threadId].votes = filters[threadId].votes || { countVotes: true, dayStarts: [], votesByPostNumber: {}};
	filters[threadId].votes.countVotes = true;
	var index = filters[threadId].votes.dayStarts.indexOf(postNumber);
    if(index >= 0) {
		filters[threadId].votes.dayStarts.splice(index, 1);
    }
	else {
		filters[threadId].votes.dayStarts.push(postNumber);
		filters[threadId].votes.dayStarts.sort();
	}
	setThreadFilters(filters);
	fixThreadDisplay(filters);
}

function togglePost(linkNode, postId) {
	var post = postsByPostId[postId];
    var show = (post.postRows[0].style.display == "none");
	for(var k = 0; k < post.postRows.length; k++) {
		post.postRows[k].style.display = (show ? "" : "none");
	}
    updateLink(linkNode, show ? "-" : "+", show ? "#ff7777" : "#77ff77", show ? "Hide this post" : "Show this post");
}

function toggleIsolation(e, userId) {
    var filters = toggleIsUserIsolated(getCurrentThreadId(), userId);
    fixThreadDisplay(filters);
    updateUserDropdown(filters);
}

function toggleFilter(e, userId) {
    var filters = toggleIsUserFiltered(getCurrentThreadId(), userId);
    fixThreadDisplay(filters);
}

function createOrUpdateLink(parentNode, linkId, linkText, linkColor, linkToolTip, linkParam, onClick, isDisabled) {
    if(document.getElementById(parentNode.id+linkId))
        return updateLinkById(parentNode.id+linkId, linkText, linkColor, linkToolTip, isDisabled);
    else
        return createLink(parentNode, linkId, linkText, linkColor, linkToolTip, linkParam, onClick, isDisabled);
}

function createLink(parentNode, linkId, linkText, linkColor, linkToolTip, linkParam, onClick, isDisabled) {
    var link = document.createElement("a");
    link.setAttribute("linkParam", linkParam);
    link.innerHTML = "<span id='" + parentNode.id + linkId + "' style='color: " + (isDisabled ? "#777777" : linkColor) + "; cursor: pointer;'><b>" + linkText + "</b></span>";
    link.setAttribute("title", linkToolTip);
    link.setAttribute("disabled", !!isDisabled);
    link.style.marginRight = "1em";
    function listener(e) {
        var linkParam = e.target.parentNode.parentNode.getAttribute("linkParam");
        var isDisabled = e.target.parentNode.parentNode.getAttribute("disabled");
        //alert("Link parameter: " + linkParam);
        e.preventDefault();
        e.stopPropagation();
        if(isDisabled == "false") onClick(e.target.parentNode, linkParam);
    }
    link.addEventListener("click", listener, false);
    parentNode.appendChild(link);
    return link;
}

function updateLinkById(linkId, linkText, linkColor, linkToolTip, isDisabled) {
    var linkNode = document.getElementById(linkId);
    return updateLink(linkNode, linkText, linkColor, linkToolTip, isDisabled);
}

function updateLink(linkNode, linkText, linkColor, linkToolTip, isDisabled) {
    if(linkColor) linkNode.style.color = (isDisabled ? "#777777" : linkColor);
    if(linkToolTip) linkNode.parentNode.setAttribute("title", linkToolTip);
    if(linkText) linkNode.innerHTML = "<b>" + linkText + "</b>";
    linkNode.parentNode.setAttribute("disabled", !!isDisabled);
    return linkNode;
}

function createSelect(parentNode, selectId, options, onChange, selected) {
    var select = document.createElement("select");    
    for (var i = 0; i < options.length; i++) {
        var op = document.createElement("option");
        op.innerHTML = options[i][0];
        op.value = options[i][1];
        if (options[i][1] == selected) {
            op.setAttribute("selected", "selected");
        }
        select.appendChild(op);
    }
    function listener(e) {
        e.preventDefault();
        e.stopPropagation();
        onChange(e.target.value);
    }
    select.setAttribute("id", parentNode.id + selectId);
    select.addEventListener("change", listener);
    select.style.marginRight = "1em";
    parentNode.appendChild(select);
    return select;
}

function removeElement(elementId) {
    var elem = document.getElementById(elementId);
    if (elem) {
        elem.parentNode.removeChild(elem);
    }
}

function isUserFiltered(filters, threadId, userId) {
    userId = "u" + userId;
    if(!filters) filters = getThreadFilters();
    if(!filters[threadId]) return false;
    return !!(filters[threadId].usersToHide[userId]);
}

function isUserIsolated(filters, threadId, userId) {
    if(!filters) filters = getThreadFilters();
    if(!filters[threadId]) return false;
	if(!filters[threadId].usersToShowExclusively) return false;
	if(!(userId)) return filters[threadId].usersToShowExclusively.length > 0;
	return (filters[threadId].usersToShowExclusively.indexOf(userId) >= 0);
}

function toggleIsUserIsolated(threadId, userId) {
    var filters = getThreadFilters();
	filters[threadId].usersToShowExclusively = filters[threadId].usersToShowExclusively || [];
	var index = filters[threadId].usersToShowExclusively.indexOf(userId);
    if(index >= 0) {
		filters[threadId].usersToShowExclusively.splice(index, 1);
    }
	else {
		filters[threadId].usersToShowExclusively.push(userId);
	}
	setThreadFilters(filters);
	return filters;
}

function toggleIsUserFiltered(threadId, userId) {
    //console.log("Toggling filter for thread " + threadId + " and user " + userId);
    userId = "u" + userId;
    var filters = getThreadFilters();
    //console.dir(filters);
    filters[threadId].usersToHide[userId] = !filters[threadId].usersToHide[userId];
    //console.dir(filters);
    setThreadFilters(filters);
    return filters;
}

function isolateOneUser(userId) {
    var filters = getThreadFilters();
    var t = getCurrentThreadId();
    filters[t].usersToShowExclusively = (userId == 0 || userId == "0") ? [] : [userId];
    filters[t].usersToHide = {};
    setThreadFilters(filters);
    fixThreadDisplay(filters);
}

function isIsolatingOneUser(filters, userId) {
    var t = getCurrentThreadId();
    if (filters[t].usersToShowExclusively.length == 1 && filters[t].usersToShowExclusively[0] == userId)
        return true;
    return false;
}

function getThreadFilters()
{
    var t = GM_getValue("threadFilters");
	var r = {};
	if(t) r = JSON.parse(t);
	var threadId = getCurrentThreadId();
    r[threadId] = r[threadId] || { usersToHide: {}, usersToShowExclusively: [], posters: {} };
	return r;
}

function setThreadFilters(filters)
{
    var val = JSON.stringify(filters);
	//console.log("Setting filters to " + val);
    GM_setValue("threadFilters", val);
}

function updatePosters(filters, posts) {
    var t = filters[getCurrentThreadId()];
    t.posters = t.posters || {};
    var changed = false;
    for (var i = 0; i < posts.length; i++) {
        if (t.posters[posts[i].userId] != posts[i].userName) {
        	t.posters[posts[i].userId] = posts[i].userName;
            changed = true;
        }
    }
    if (changed)
    	setThreadFilters(filters);
}

function fixHeader(filters) {
    var menu = document.getElementById("MafiaHelperMenu");
    if(!menu) {
		var insertBeforeDiv = document.getElementById("postlist_popups");
        if(insertBeforeDiv) {
			isVBulletin = true;
		}
		else {
			var postsDiv = document.getElementById("posts");
			if(postsDiv) {
				var titleTable = postsDiv.previousElementSibling || postsDiv.previousSibling;
        insertBeforeDiv = postsDiv.parentNode.parentNode.previousSibling.previousSibling.children[0].children[1]
			}
		}
        if(!insertBeforeDiv) return;
        var span = document.createElement("SPAN");
        span.id = "MafiaHelperMenu";
        span.style.marginRight = "1em";
        span.innerHTML = "<span id='MafiaHelperMenu_UserMenu' style='margin-right: 1em'>";
        insertBeforeDiv.parentNode.insertBefore(span, insertBeforeDiv);
        menu = span;
    }
    var enabled = filters[getCurrentThreadId()] && filters[getCurrentThreadId()].isEnabled;
    createOrUpdateLink(menu, "_clearFilters", "Clear", "#ff7777", "Clear all filters for this thread", "clear", clearFilters, !enabled);
    createOrUpdateLink(menu, "_clearDayStarts", "Clear tallies", "#ff7777", "Remove all day starts for this thread", "clear", clearDayStarts, !enabled);
    if(enabled)
    	createOrUpdateLink(menu, "_toggleIsEnabled", "Disable Mafia Helper", "#ff7777", "Disable the Mafia Helper functionality for this thread", "disable", toggleIsEnabled);
    else {
    	createOrUpdateLink(menu, "_toggleIsEnabled", "Enable Mafia Helper", "#77ff77", "Enable the Mafia Helper functionality for this thread", "enable", toggleIsEnabled);
    }
}

function updateUserDropdown(filters) {
    var t = getCurrentThreadId();
	var enabled = filters[t] && filters[t].isEnabled;
    var menu = document.getElementById("MafiaHelperMenu_UserMenu");
    if (menu) {
    	removeElement(menu.id + "_isolateUser");
    	if (enabled) {
            var posters = filters[t].posters;
            var options = [];
            var selected = 0;
            for (var userId in posters) {
                options.push([posters[userId], userId]);
                if (isIsolatingOneUser(filters, userId)) {
                    selected = userId;
                }
            }
            options.sort(function (a, b) {
                return a[0].toLowerCase().localeCompare(b[0].toLowerCase());
            });
            options.unshift(["Everybody", 0]);
            createSelect(menu, "_isolateUser", options, isolateOneUser, selected);
        }
    }                             
}

function clearDayStarts(e, linkParam) {
    var filters = getThreadFilters();
    if(filters[getCurrentThreadId()].votes) {
		filters[getCurrentThreadId()].votes.dayStarts = [];
		filters[getCurrentThreadId()].votes.votesByPostNumber = {};
		filters[getCurrentThreadId()].aliases = [];
	}
    setThreadFilters(filters);
    fixThreadDisplay(filters);
}

function clearFilters(e, linkParam) {
    var filters = getThreadFilters();
    filters[getCurrentThreadId()].usersToHide = {};
    filters[getCurrentThreadId()].usersToShowExclusively = [];
    setThreadFilters(filters);
    fixThreadDisplay(filters);
    updateUserDropdown(filters);
}

function toggleIsEnabled(e, linkParam) {
    var filters = getThreadFilters();
    filters[getCurrentThreadId()].isEnabled = !filters[getCurrentThreadId()].isEnabled;
    setThreadFilters(filters);
    fixHeader(filters);
    fixThreadDisplay(filters);
    updateUserDropdown(filters);
}

function main()
{
    var path = document.location.pathname;
    if (path.match(/showthread\.php/)) {
        var filters = getThreadFilters();
        console.log("Current settings:");
        console.dir(filters);
        fixHeader(filters);
        if(filters[getCurrentThreadId()].isEnabled) {
        	fixThreadDisplay(filters);
		    updateUserDropdown(filters);
        }
    }
}

var colorMap = [ { "name":"aliceblue", "hex":"#f0f8ff" }, { "name":"antiquewhite", "hex":"#faebd7" }, { "name":"aqua", "hex":"#00ffff" }, { "name":"aquamarine", "hex":"#7fffd4" }, { "name":"azure", "hex":"#f0ffff" }, { "name":"beige", "hex":"#f5f5dc" }, { "name":"bisque", "hex":"#ffe4c4" }, { "name":"black", "hex":"#000000" }, { "name":"blanchedalmond", "hex":"#ffebcd" }, { "name":"blue", "hex":"#0000ff" }, { "name":"blueviolet", "hex":"#8a2be2" }, { "name":"brown", "hex":"#a52a2a" }, { "name":"burlywood", "hex":"#deb887" }, { "name":"cadetblue", "hex":"#5f9ea0" }, { "name":"chartreuse", "hex":"#7fff00" }, { "name":"chocolate", "hex":"#d2691e" }, { "name":"coral", "hex":"#ff7f50" }, { "name":"cornflowerblue", "hex":"#6495ed" }, { "name":"cornsilk", "hex":"#fff8dc" }, { "name":"crimson", "hex":"#dc143c" }, { "name":"cyan", "hex":"#00ffff" }, { "name":"darkblue", "hex":"#00008b" }, { "name":"darkcyan", "hex":"#008b8b" }, { "name":"darkgoldenrod", "hex":"#b8860b" }, { "name":"darkgray", "hex":"#a9a9a9" }, { "name":"darkgreen", "hex":"#006400" }, { "name":"darkkhaki", "hex":"#bdb76b" }, { "name":"darkmagenta", "hex":"#8b008b" }, { "name":"darkolivegreen", "hex":"#556b2f" }, { "name":"darkorange", "hex":"#ff8c00" }, { "name":"darkorchid", "hex":"#9932cc" }, { "name":"darkred", "hex":"#8b0000" }, { "name":"darksalmon", "hex":"#e9967a" }, { "name":"darkseagreen", "hex":"#8fbc8f" }, { "name":"darkslateblue", "hex":"#483d8b" }, { "name":"darkslategray", "hex":"#2f4f4f" }, { "name":"darkturquoise", "hex":"#00ced1" }, { "name":"darkviolet", "hex":"#9400d3" }, { "name":"deeppink", "hex":"#ff1493" }, { "name":"deepskyblue", "hex":"#00bfff" }, { "name":"dimgray", "hex":"#696969" }, { "name":"dodgerblue", "hex":"#1e90ff" }, { "name":"firebrick", "hex":"#b22222" }, { "name":"floralwhite", "hex":"#fffaf0" }, { "name":"forestgreen", "hex":"#228b22" }, { "name":"fuchsia", "hex":"#ff00ff" }, { "name":"gainsboro", "hex":"#dcdcdc" }, { "name":"ghostwhite", "hex":"#f8f8ff" }, { "name":"gold", "hex":"#ffd700" }, { "name":"goldenrod", "hex":"#daa520" }, { "name":"gray", "hex":"#808080" }, { "name":"green", "hex":"#008000" }, { "name":"greenyellow", "hex":"#adff2f" }, { "name":"honeydew", "hex":"#f0fff0" }, { "name":"hotpink", "hex":"#ff69b4" }, { "name":"indianred", "hex":"#cd5c5c" }, { "name":"indigo", "hex":"#4b0082" }, { "name":"ivory", "hex":"#fffff0" }, { "name":"khaki", "hex":"#f0e68c" }, { "name":"lavender", "hex":"#e6e6fa" }, { "name":"lavenderblush", "hex":"#fff0f5" }, { "name":"lawngreen", "hex":"#7cfc00" }, { "name":"lemonchiffon", "hex":"#fffacd" }, { "name":"lightblue", "hex":"#add8e6" }, { "name":"lightcoral", "hex":"#f08080" }, { "name":"lightcyan", "hex":"#e0ffff" }, { "name":"lightgoldenrodyellow", "hex":"#fafad2" }, { "name":"lightgray", "hex":"#d3d3d3" }, { "name":"lightgreen", "hex":"#90ee90" }, { "name":"lightpink", "hex":"#ffb6c1" }, { "name":"lightsalmon", "hex":"#ffa07a" }, { "name":"lightseagreen", "hex":"#20b2aa" }, { "name":"lightskyblue", "hex":"#87cefa" }, { "name":"lightslategray", "hex":"#778899" }, { "name":"lightsteelblue", "hex":"#b0c4de" }, { "name":"lightyellow", "hex":"#ffffe0" }, { "name":"lime", "hex":"#00ff00" }, { "name":"limegreen", "hex":"#32cd32" }, { "name":"linen", "hex":"#faf0e6" }, { "name":"magenta", "hex":"#ff00ff" }, { "name":"maroon", "hex":"#800000" }, { "name":"mediumaquamarine", "hex":"#66cdaa" }, { "name":"mediumblue", "hex":"#0000cd" }, { "name":"mediumorchid", "hex":"#ba55d3" }, { "name":"mediumpurple", "hex":"#9370db" }, { "name":"mediumseagreen", "hex":"#3cb371" }, { "name":"mediumslateblue", "hex":"#7b68ee" }, { "name":"mediumspringgreen", "hex":"#00fa9a" }, { "name":"mediumturquoise", "hex":"#48d1cc" }, { "name":"mediumvioletred", "hex":"#c71585" }, { "name":"midnightblue", "hex":"#191970" }, { "name":"mintcream", "hex":"#f5fffa" }, { "name":"mistyrose", "hex":"#ffe4e1" }, { "name":"moccasin", "hex":"#ffe4b5" }, { "name":"navajowhite", "hex":"#ffdead" }, { "name":"navy", "hex":"#000080" }, { "name":"oldlace", "hex":"#fdf5e6" }, { "name":"olive", "hex":"#808000" }, { "name":"olivedrab", "hex":"#6b8e23" }, { "name":"orange", "hex":"#ffa500" }, { "name":"orangered", "hex":"#ff4500" }, { "name":"orchid", "hex":"#da70d6" }, { "name":"palegoldenrod", "hex":"#eee8aa" }, { "name":"palegreen", "hex":"#98fb98" }, { "name":"paleturquoise", "hex":"#afeeee" }, { "name":"palevioletred", "hex":"#db7093" }, { "name":"papayawhip", "hex":"#ffefd5" }, { "name":"peachpuff", "hex":"#ffdab9" }, { "name":"peru", "hex":"#cd853f" }, { "name":"pink", "hex":"#ffc0cb" }, { "name":"plum", "hex":"#dda0dd" }, { "name":"powderblue", "hex":"#b0e0e6" }, { "name":"purple", "hex":"#800080" }, { "name":"red", "hex":"#ff0000" }, { "name":"rosybrown", "hex":"#bc8f8f" }, { "name":"royalblue", "hex":"#4169e1" }, { "name":"saddlebrown", "hex":"#8b4513" }, { "name":"salmon", "hex":"#fa8072" }, { "name":"sandybrown", "hex":"#f4a460" }, { "name":"seagreen", "hex":"#2e8b57" }, { "name":"seashell", "hex":"#fff5ee" }, { "name":"sienna", "hex":"#a0522d" }, { "name":"silver", "hex":"#c0c0c0" }, { "name":"skyblue", "hex":"#87ceeb" }, { "name":"slateblue", "hex":"#6a5acd" }, { "name":"slategray", "hex":"#708090" }, { "name":"snow", "hex":"#fffafa" }, { "name":"springgreen", "hex":"#00ff7f" }, { "name":"steelblue", "hex":"#4682b4" }, { "name":"tan", "hex":"#d2b48c" }, { "name":"teal", "hex":"#008080" }, { "name":"thistle", "hex":"#d8bfd8" }, { "name":"tomato", "hex":"#ff6347" }, { "name":"turquoise", "hex":"#40e0d0" }, { "name":"violet", "hex":"#ee82ee" }, { "name":"wheat", "hex":"#f5deb3" }, { "name":"white", "hex":"#ffffff" }, { "name":"whitesmoke", "hex":"#f5f5f5" }, { "name":"yellow", "hex":"#ffff00" }, { "name":"yellowgreen", "hex":"#9acd32" } ];
function getColorFromNamedColor(colorName) {
	for(var i = 0; i < colorMap.length; i++) {
		if(colorMap[i].name == colorName) return colorMap[i].hex;
	}
	return null;
}

function parseColorValue(value) {
	value = value.trim();
	if(value == "") return 0;
	if(value.indexOf("%") == value.length - 1) return Math.round(parseColorValue(value.substring(0, value.length-1)) * 255 / 100);
	return parseInt(value);
}

function getHSL(color) {
	color = color.toString().trim().toLowerCase();
	var hue = 0, saturation = 0, lightness = 0, alpha = 1;
	if(color.indexOf("hsla(") == 0) {
		var i = color.indexOf(")");
		if(i < 5) return null;
		var hsla = color.substring(5, i).split(",");
		if(hsla.length > 3) alpha = parseFloat(hsla[3].trim());
		if(hsla.length > 2) lightness = parseFloat(hsla[2].trim().replace("%", ""));
		if(hsla.length > 1) saturation = parseFloat(hsla[1].trim().replace("%", ""));
		hue = parseFloat(hsla[0].trim());
	}
	else if(color.indexOf("hsl(") == 0) {
		var i = color.indexOf(")");
		if(i < 4) return null;
		var hsl = color.substring(4, i).split(",");
		if(hsl.length > 2) lightness = parseFloat(hsl[2].trim().replace("%", ""));
		if(hsl.length > 1) saturation = parseFloat(hsl[1].trim().replace("%", ""));
		hue = parseFloat(hsl[0].trim());
	}
	else {
		var red = 0, green = 0, blue = 0;
		if(color.indexOf("rgba(") == 0) {
			var i = color.indexOf(")");
			if(i < 5) return null;
			var rgba = color.substring(5, i).split(",");
			if(rgba.length > 3) alpha = parseFloat(rgba[3].trim());
			if(rgba.length > 2) blue = parseColorValue(rgba[2]);
			if(rgba.length > 1) green = parseColorValue(rgba[1]);
			red = parseColorValue(rgba[0]);
		}
		else if(color.indexOf("rgb(") == 0) {
			var i = color.indexOf(")");
			if(i < 4) return null;
			var rgb = color.substring(4, i).split(",");
			if(rgb.length > 2) blue = parseColorValue(rgb[2]);
			if(rgb.length > 1) green = parseColorValue(rgb[1]);
			red = parseColorValue(rgb[0]);
		}
		else {
			if(color.indexOf("#") != 0) {
				color = getColorFromNamedColor(color);
				if(!color) return null;
			}
			if(color.length != 4 && color.length != 7) return null;
			// expand shorthand hex e.g. #fff to #ffffff
			if(color.length == 4) color = "#" + color.substring(1,2) + color.substring(1,2) + color.substring(2,3) + color.substring(2,3) + color.substring(3,4) + color.substring(3,4);
			red = parseInt(color.substring(1,3), 16);
			green = parseInt(color.substring(3,5), 16);
			blue = parseInt(color.substring(5), 16);
		}
		return getHSLfromRGB(red, green, blue);
	}
	return [hue, saturation, lightness, alpha];
}

function getHSLfromRGB(red, green, blue) {
    var r1 = red / 255;
    var g1 = green / 255;
    var b1 = blue / 255;
 
    var maxColor = Math.max(r1,g1,b1);
    var minColor = Math.min(r1,g1,b1);
    //Calculate L:
    var L = (maxColor + minColor) / 2 ;
    var S = 0;
    var H = 0;
    if(maxColor != minColor){
        //Calculate S:
        if(L < 0.5){
            S = (maxColor - minColor) / (maxColor + minColor);
        }else{
            S = (maxColor - minColor) / (2.0 - maxColor - minColor);
        }
        //Calculate H:
        if(r1 == maxColor){
            H = (g1-b1) / (maxColor - minColor);
        }else if(g1 == maxColor){
            H = 2.0 + (b1 - r1) / (maxColor - minColor);
        }else{
            H = 4.0 + (r1 - g1) / (maxColor - minColor);
        }
    }
 
    L = L * 100;
    S = S * 100;
    H = H * 60;
    if(H<0){
        H += 360;
    }
 	return [H, S, L, 1];
}

function isColorGreenish(color) {
	if(!(color)) return false;
	var hsl = getHSL(color);
	if(hsl == null) return false;
	return ((hsl[0] < 145 && hsl[0] > 80) && hsl[1] > 10 && hsl[2] > 10 && hsl[2] < 95 && hsl[3] > 0.3);
}

function isColorReddish(color) {
	if(!(color)) return false;
	var hsl = getHSL(color);
	if(hsl == null) return false;
	return ((hsl[0] < 35 || hsl[0] > 325) && hsl[1] > 10 && hsl[2] > 10 && hsl[2] < 95 && hsl[3] > 0.3);
}

main();

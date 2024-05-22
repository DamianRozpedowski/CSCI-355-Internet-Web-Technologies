/*  
    Damian Rozpedowski CS355 Internet Web Technologies Final Project
    Combines NewsAPI + DetectLanguageAPI to retrieve top headlines and
    classify the language they are written in.
*/
const fs = require("fs");
const http = require("http");
const https = require("https");

const credentials = require("./auth/credentials.json");

const port = 3000;
const server = http.createServer();

// Used for error checking
const supportedCountries = ["AE", "AR", "AT", "AU", "BE", "BG", "BR", "CA", "CH", "CN", "CO", "CU", "CZ", "DE", "EG", "FR", "GB", "GR", "HK", "HU", "ID", "IE", "IL", "IN", "IT", "JP", "KR", "LT", "LV", "MA", "MX", "MY", "NG", "NL", "NO", "NZ", "PH", "PL", "PT", "RO", "RS", "RU", "SA", "SE", "SG", "SI", "SK", "TH", "TR", "TW", "UA", "US", "VE", "ZA"];
const supportedCategories = ["Business", "Entertainment", "General", "Health", "Science", "Sports", "Technology"];

server.on("listening", listen_handler);
server.listen(port);
function listen_handler(){
    console.log(`Now Listening on Port ${port}`);
}

server.on("request", request_handler);

function request_handler(req, res){
    console.log(`New Request from ${req.socket.remoteAddress} for ${req.url}`);
    if(req.url === "/"){
        const form = fs.createReadStream("html/index.html");
		res.writeHead(200, {"Content-Type": "text/html"})
		form.pipe(res);
    }
    else if (req.url.startsWith("/fetch_headlines")){
        const user_input = new URL(req.url, `http://${req.headers.host}`).searchParams;
        let country = user_input.get('country');
        let category = user_input.get('category');

        if (!country || !category || !supportedCountries.includes(country) || !supportedCategories.includes(category)) {
            res.writeHead(400, {"Content-Type": "text/html; charset=utf-8"});
            res.end("<h1>400 Bad Request: Missing or unsupported country or category parameter</h1>");
            return;
        }

        res.writeHead(200, {"Content-Type": "text/html"});
        get_news_headlines(country, category, res);
    }
    else{
        res.writeHead(404, {"Content-Type": "text/html"});
        res.end(`<h1>404 Not Found</h1>`);
    }
}

function get_news_headlines(country, category, res){
    const newsApiKey = credentials.NewsAPI['Authorization-Key'];
    const newsApiUrl = `https://newsapi.org/v2/top-headlines?country=${country}&category=${category}&apiKey=${newsApiKey}`;
    const headersCred = {
        "Host": credentials.NewsAPI['Host'], 
        "User-Agent": credentials.NewsAPI['User-Agent'],
        "Authorization": credentials.NewsAPI['Authorization-Key'], 
    };

    /* // Checks for synchronous behavior, comment out other const news_request if testing.
    const news_request = https.request(newsApiUrl, {method: "GET", headers: headersCred});
    // Introduce the delay using setTimeout before sending the request
    setTimeout(() => {
        console.log("NewsAPI finished waiting")
      news_request.end();
    }, 5000);
    */
    console.log("NewsAPI has been called");
    const news_request = https.get(newsApiUrl, {method: "GET", headers: headersCred});
    news_request.once("response", process_stream);

    function process_stream(news_stream){
        news_stream.setEncoding('utf8');
        let news_data = "";
        news_stream.on("data", chunk => news_data += chunk);
        news_stream.on("end", () => {
            console.log("NewsAPI finished");
            process_news_data(news_data, res);
        });
    }
}

function process_news_data(news_data, res){
    try {
        let news_object = JSON.parse(news_data);
        if (news_object.status === "ok" && news_object.articles) {
            let articles = news_object.articles;
            detect_languages(articles, res);
        } else {
            console.log("API response is not OK or missing articles:", news_data);
            res.writeHead(404, {"Content-Type": "text/html; charset=utf-8"});
            res.end("<h1>No articles found or API returned an error</h1>");
        }
    } catch (error) {
        console.error("Error processing news data:", error);
        res.writeHead(500, {"Content-Type": "text/html; charset=utf-8"});
        res.end("<h1>Internal Server Error</h1>");
    }
}

function detect_languages(articles, res) {
    const detectLangApiKey = credentials.DetectLanguage['API-Key'];
    const detectLangApiUrl = `https://ws.detectlanguage.com/0.2/detect`;

    let titles = articles.map(article => article.title || 'No title available');
    //console.log("Titles to detect language for:", titles);

    let data = JSON.stringify({ q: titles });
    //console.log("Request payload:", data);

    const options = {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${detectLangApiKey}`,
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data) // Ensure correct content length
        }
    };
    
    console.log("DetectLanguagesAPI has been called");
    const detectLang_request = https.request(detectLangApiUrl, options, process_detectLang_response);

    detectLang_request.on("error", error => {
        console.error("Error with DetectLanguage API request:", error);
        res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
        res.end("<h1>Internal Server Error</h1>");
    });

    detectLang_request.write(data);
    detectLang_request.end();

    function process_detectLang_response(detectLang_response) {
        let detectLang_data = "";
        detectLang_response.on("data", chunk => detectLang_data += chunk);
        detectLang_response.on("end", () => {
            console.log("DetectLanguagesAPI finished");
            try {
                let languageResults = JSON.parse(detectLang_data);
                //console.log("Language detection response:", languageResults);

                if (languageResults.data && languageResults.data.detections) {
                    articles.forEach((article, index) => {
                        if (languageResults.data.detections[index] && languageResults.data.detections[index][0]) {
                            article.language = languageResults.data.detections[index][0].language;
                        } else {
                            article.language = "Unknown";
                        }
                    });
                    display_articles(articles, res);
                } else {
                    console.error("Language detection failed", detectLang_data);
                    res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
                    res.end("<h1>Error detecting languages</h1>");
                }
            } catch (error) {
                console.error("Error parsing language detection response:", error);
                res.writeHead(500, { "Content-Type": "text/html; charset=utf-8" });
                res.end("<h1>Internal Server Error</h1>");
            }
        });
    }
}

function display_articles(articles, res){
    let results = articles.map(format_article).join('');
    let htmlContent = `
        <html>
        <head>
            <title>Top Headlines</title>
            <style>
                body {
                    font-family: Arial, sans-serif;
                    background-color: #f9f9f9;
                    color: #333;
                    padding: 20px;
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    min-height: 100vh;
                }
                .container {
                    background-color: #fff;
                    padding: 20px;
                    border-radius: 8px;
                    box-shadow: 0 0 10px rgba(0,0,0,0.1);
                    max-width: 800px;
                    width: 100%;
                }
                h1 {
                    font-size: 24px;
                    margin-bottom: 20px;
                    text-align: center;
                    color: #007BFF;
                }
                ul {
                    list-style: none;
                    padding: 0;
                }
                li {
                    background-color: #f1f1f1;
                    margin: 10px 0;
                    padding: 15px;
                    border-radius: 5px;
                    box-shadow: 0 0 5px rgba(0,0,0,0.1);
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                }
                li img {
                    max-width: 150px;
                    margin-left: 15px;
                    border-radius: 5px;
                }
                li .text-content {
                    flex: 1;
                }
                li a {
                    color: #007BFF;
                    text-decoration: none;
                    font-weight: bold;
                    font-size: 18px;
                }
                li p {
                    margin: 5px 0;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Top Headlines:</h1>
                <ul>${results}</ul>
            </div>
        </body>
        </html>`;
    res.writeHead(200, {"Content-Type": "text/html; charset=utf-8"});
    res.end(htmlContent);
}

// All languages available in the DetectLanguageAPI
const languageMap = {
    "aa": "Afar", "ab": "Abkhazian", "af": "Afrikaans", "ak": "Akan", "am": "Amharic",
    "ar": "Arabic", "as": "Assamese", "ay": "Aymara", "az": "Azerbaijani", "ba": "Bashkir",
    "be": "Belarusian", "bg": "Bulgarian", "bh": "Bihari", "bi": "Bislama", "bn": "Bengali",
    "bo": "Tibetan", "br": "Breton", "bs": "Bosnian", "bug": "Buginese", "ca": "Catalan",
    "ceb": "Cebuano", "chr": "Cherokee", "co": "Corsican", "crs": "Seselwa", "cs": "Czech",
    "cy": "Welsh", "da": "Danish", "de": "German", "dv": "Dhivehi", "dz": "Dzongkha",
    "egy": "Egyptian", "el": "Greek", "en": "English", "eo": "Esperanto", "es": "Spanish",
    "et": "Estonian", "eu": "Basque", "fa": "Persian", "fi": "Finnish", "fj": "Fijian",
    "fo": "Faroese", "fr": "French", "fy": "Frisian", "ga": "Irish", "gd": "Scots Gaelic",
    "gl": "Galician", "gn": "Guarani", "got": "Gothic", "gu": "Gujarati", "gv": "Manx",
    "ha": "Hausa", "haw": "Hawaiian", "hi": "Hindi", "hmn": "Hmong", "hr": "Croatian",
    "ht": "Haitian Creole", "hu": "Hungarian", "hy": "Armenian", "ia": "Interlingua", "id": "Indonesian",
    "ie": "Interlingue", "ig": "Igbo", "ik": "Inupiak", "is": "Icelandic", "it": "Italian",
    "iu": "Inuktitut", "iw": "Hebrew", "ja": "Japanese", "jw": "Javanese", "ka": "Georgian",
    "kha": "Khasi", "kk": "Kazakh", "kl": "Greenlandic", "km": "Khmer", "kn": "Kannada",
    "ko": "Korean", "ks": "Kashmiri", "ku": "Kurdish", "ky": "Kyrgyz", "la": "Latin",
    "lb": "Luxembourgish", "lg": "Ganda", "lif": "Limbu", "ln": "Lingala", "lo": "Laothian",
    "lt": "Lithuanian", "lv": "Latvian", "mfe": "Mauritian Creole", "mg": "Malagasy", "mi": "Maori",
    "mk": "Macedonian", "ml": "Malayalam", "mn": "Mongolian", "mr": "Marathi", "ms": "Malay",
    "mt": "Maltese", "my": "Burmese", "na": "Nauru", "ne": "Nepali", "nl": "Dutch",
    "no": "Norwegian", "nr": "Ndebele", "nso": "Pedi", "ny": "Nyanja", "oc": "Occitan",
    "om": "Oromo", "or": "Oriya", "pa": "Punjabi", "pl": "Polish", "ps": "Pashto",
    "pt": "Portuguese", "qu": "Quechua", "rm": "Rhaeto Romance", "rn": "Rundi", "ro": "Romanian",
    "ru": "Russian", "rw": "Kinyarwanda", "sa": "Sanskrit", "sco": "Scots", "sd": "Sindhi",
    "sg": "Sango", "si": "Sinhalese", "sk": "Slovak", "sl": "Slovenian", "sm": "Samoan",
    "sn": "Shona", "so": "Somali", "sq": "Albanian", "sr": "Serbian", "ss": "Siswant",
    "st": "Sesotho", "su": "Sundanese", "sv": "Swedish", "sw": "Swahili", "syr": "Syriac",
    "ta": "Tamil", "te": "Telugu", "tg": "Tajik", "th": "Thai", "ti": "Tigrinya",
    "tk": "Turkmen", "tl": "Tagalog", "tlh": "Klingon", "tn": "Tswana", "to": "Tonga",
    "tr": "Turkish", "ts": "Tsonga", "tt": "Tatar", "ug": "Uighur", "uk": "Ukrainian",
    "ur": "Urdu", "uz": "Uzbek", "ve": "Venda", "vi": "Vietnamese", "vo": "Volapuk",
    "war": "Waray Philippines", "wo": "Wolof", "xh": "Xhosa", "yi": "Yiddish", "yo": "Yoruba",
    "za": "Zhuang", "zh": "Chinese Simplified", "zh-Hant": "Chinese Traditional", "zu": "Zulu"
};

function format_article(article){
    let title = article.title || 'No title available';
    let description = article.description || 'No description available.';
    let url = article.url || '#';
    let sourceName = article.source.name || "No source available";
    let imageUrl = article.urlToImage || '';
    let language = article.language || "Unknown";
    let languageName = languageMap[language] || "Unknown";
    return `
    <li>
        <div class="text-content">
            <a href="${url}" target="_blank">${title}</a>
            <p>${description}</p>
            <p>Source: ${sourceName}</p>
            <strong><p>Language: ${language} - ${languageName}</p></strong>
        </div>
        <img src="${imageUrl}">
    </li>`;
}
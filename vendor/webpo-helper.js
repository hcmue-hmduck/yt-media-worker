// googlevideo-trial/examples/downloader/utils/webpo-helper.ts
import { JSDOM } from "jsdom";
import { BotGuardClient } from "bgutils-js/botguard";
import { WebPoMinter } from "bgutils-js/webpo";
import { getHeaders, buildURL, USER_AGENT, parseLooseJSON } from "bgutils-js/utils";
async function getWebPoMinter() {
  const dom = new JSDOM('<!DOCTYPE html><html lang="en"><head><title></title></head><body></body></html>', {
    url: "https://www.youtube.com",
    referrer: "https://www.youtube.com/",
    userAgent: USER_AGENT
  });
  const pageResponse = await fetch("https://www.youtube.com", {
    headers: {
      "accept": "*/*",
      "accept-language": "en-US,en;q=0.7",
      "user-agent": USER_AGENT
    }
  });
  const pageHtml = await pageResponse.text();
  const ytConfig = pageHtml.match(/ytcfg\.set\(({.+?})\);/s)?.[1];
  if (!ytConfig) {
    throw new Error("Could not find ytcfg in page HTML");
  }
  dom.window.yt = {
    config_: JSON.parse(ytConfig)
    /* Needed because of EVENT_ID */
  };
  dom.window.HTMLCanvasElement.prototype.getContext = function(contextId) {
    if (contextId !== "2d") return null;
    return {
      fillRect: () => {
      },
      clearRect: () => {
      },
      getImageData: (_x, _y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => {
      },
      createImageData: () => [],
      setTransform: () => {
      },
      drawImage: () => {
      },
      save: () => {
      },
      fillText: () => {
      },
      restore: () => {
      },
      beginPath: () => {
      },
      moveTo: () => {
      },
      lineTo: () => {
      },
      closePath: () => {
      },
      stroke: () => {
      },
      translate: () => {
      },
      scale: () => {
      },
      rotate: () => {
      },
      arc: () => {
      },
      fill: () => {
      },
      measureText: () => ({ width: 0 }),
      transform: () => {
      },
      rect: () => {
      },
      clip: () => {
      }
    };
  };
  Object.assign(globalThis, {
    yt: dom.window.yt,
    window: dom.window,
    document: dom.window.document,
    location: dom.window.location,
    origin: dom.window.origin
  });
  if (!("navigator" in globalThis)) {
    Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator });
  }
  const initialAttestationData = pageHtml.match(/window\.ytAtN\(\s*({[\s\S]*?})\s*\)/);
  if (!initialAttestationData) {
    throw new Error("Could not find challenge in page HTML");
  }
  const initialAttestationDataJson = parseLooseJSON(initialAttestationData[1]);
  const challengeResponse = initialAttestationDataJson.R;
  if (!challengeResponse.bgChallenge)
    throw new Error("Could not get challenge");
  const interpreterUrl = challengeResponse.bgChallenge.interpreterUrl.privateDoNotAccessOrElseTrustedResourceUrlWrappedValue;
  const bgScriptResponse = await fetch(`https:${interpreterUrl}`);
  const interpreterJavascript = await bgScriptResponse.text();
  if (interpreterJavascript) {
    new Function(interpreterJavascript)();
  } else throw new Error("Could not load VM");
  const botGuardClient = await BotGuardClient.create({
    program: challengeResponse.bgChallenge.program,
    globalName: challengeResponse.bgChallenge.globalName,
    globalObject: globalThis
  });
  const requestKey = "O43z0dpjhgX20SCx4KAo";
  const webPoSignalOutput = [];
  const botguardResponse = await botGuardClient.snapshot({ webPoSignalOutput });
  const payload = [requestKey, botguardResponse];
  const integrityTokenResponse = await fetch(buildURL("GenerateIT", true), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload)
  });
  const integrityTokenJson = await integrityTokenResponse.json();
  const [integrityToken, estimatedTtlSecs, mintRefreshThreshold, websafeFallbackToken] = integrityTokenJson;
  const integrityTokenData = {
    integrityToken,
    estimatedTtlSecs,
    mintRefreshThreshold,
    websafeFallbackToken
  };
  const webPoMinter = await WebPoMinter.create(integrityTokenData, webPoSignalOutput);
  return webPoMinter;
}
export {
  getWebPoMinter
};

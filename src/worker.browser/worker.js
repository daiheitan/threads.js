import EventEmitter from 'eventemitter3';
import slaveCode from './slave-code';

import { getConfig } from '../config';


if (typeof window.Worker !== 'object' && typeof window.Worker !== 'function') {
  throw new Error('Browser does not support web workers!');
}

var blob;
try {
    blob = new Blob([slaveCode], {type: 'application/javascript'});
} catch (e) { // Backwards-compatibility
    var BlobBuilder = window.BlobBuilder || window.WebKitBlobBuilder || window.MozBlobBuilder;
    blob = new BlobBuilder();
    blob.append(slaveCode);
    blob = blob.getBlob();
}

function prependScriptUrl(scriptUrl) {
  const prefix = getConfig().basepath.web;
  return prefix ? prefix + '/' + scriptUrl : scriptUrl;
}

function convertToArray(input) {
  let outputArray = [];
  let index = 0;

  while (typeof input[index] !== 'undefined') {
    outputArray.push(input[index]);
    index++;
  }

  return outputArray;
}

function logError(error) {
  if (error.stack) {
    console.error(error.stack);                                             // eslint-disable-line no-console
  } else if (error.message && error.filename && error.lineno) {
    const fileName = error.filename.match(/^data:text\/javascript/) && error.filename.length > 50
                   ? error.filename.substr(0, 50) + '...'
                   : error.filename;
    console.error(`${error.message} @${fileName}:${error.lineno}`);   // eslint-disable-line no-console
  } else {
    console.error(error);                                                   // eslint-disable-line no-console
  }
}


export default class Worker extends EventEmitter {
  constructor(initialScript = null, importScripts = []) {
    super();

    this.initWorker();
    this.worker.addEventListener('message', this.handleMessage.bind(this));
    this.worker.addEventListener('error', this.handleError.bind(this));

    if (initialScript) {
      this.run(initialScript, importScripts);
    }
  }

  initWorker() {
    try {
      this.worker = new window.Worker(URL.createObjectURL(blob));
    } catch (error) {
      const slaveScriptUrl = getConfig().fallback.slaveScriptUrl;
      if (slaveScriptUrl) {
        // try using the slave script file instead of the data URI
        this.worker = new window.Worker(slaveScriptUrl);
      } else {
        // re-throw
        throw error;
      }
    }
  }

  run(toRun, importScripts = []) {
    if (typeof toRun === 'function') {
      this.runMethod(toRun, importScripts);
    } else {
      this.runScripts(toRun, importScripts);
    }
    return this;
  }

  require(method) {
    const methodStr = method.toString();
    const args = methodStr.substring(methodStr.indexOf('(') + 1, methodStr.indexOf(')')).split(',');
    const body = methodStr.substring(methodStr.indexOf('{') + 1, methodStr.lastIndexOf('}'));

    this.worker.postMessage({
      require: true,
      method: { args, body },
      name: method.name
    });
  }

  runMethod(method, importScripts) {
    const methodStr = method.toString();
    const args = methodStr.substring(methodStr.indexOf('(') + 1, methodStr.indexOf(')')).split(',');
    const body = methodStr.substring(methodStr.indexOf('{') + 1, methodStr.lastIndexOf('}'));

    this.worker.postMessage({
      initByMethod : true,
      method       : { args, body },
      scripts      : importScripts.map(prependScriptUrl)
    });
  }

  runScripts(script, importScripts) {
    if (!script) { throw new Error('Must pass a function or a script URL to run().'); }

    // attention: array for browser, single script for node
    this.worker.postMessage({
      initByScripts : true,
      scripts       : importScripts.concat([ script ]).map(prependScriptUrl)
    });
  }

  send(param, transferables = []) {
    this.worker.postMessage({
      doRun : true,
      param
    }, transferables);
    return this;
  }

  kill() {
    this.worker.terminate();
    this.emit('exit');
    return this;
  }

  promise() {
    return new Promise((resolve, reject) => {
      this
        .once('message', resolve)
        .once('error', reject);
    });
  }

  handleMessage(event) {
    if (event.data.error) {
      this.handleError(event.data.error);
    } else if (event.data.progress) {
      this.handleProgress(event.data.progress);
    } else {
      const responseArgs = convertToArray(event.data.response);
      this.emit('message', ...responseArgs);
    }
  }

  handleProgress(progress) {
    this.emit('progress', progress);
  }

  handleError(error) {
    if (!this.listeners('error', true)) {
      logError(error);
    }

    if (error.preventDefault) {
      error.preventDefault();
    }

    this.emit('error', error);
  }
}

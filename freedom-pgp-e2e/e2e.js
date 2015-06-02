/*globals freedom, console, e2e, exports, ArrayBuffer, Uint8Array, Uint16Array, DataView*/
/*jslint indent:2*/

if (typeof Promise === 'undefined' && typeof ES6Promise !== 'undefined') {
  // Polyfill for karma unit tests
  Promise = ES6Promise.Promise;
}

/**
 * Implementation of a crypto-pgp provider for freedom.js
 * using cryptographic code from Google's end-to-end.
 **/

var mye2e = function(dispatchEvents) {
  this.pgpContext = new e2e.openpgp.ContextImpl();
  this.pgpContext.armorOutput = false;
  this.pgpUser = null;
};


// These methods implement the actual freedom crypto API
mye2e.prototype.setup = function(passphrase, userid) {
  // userid needs to be in format "name <email>"
  if (!userid.match(/^[^<]*\s?<[^>]*>$/)) {
    return Promise.reject(Error('Invalid userid, expected: "name <email>"'));
  }
  this.pgpUser = userid;
  this.pgpContext.setKeyRingPassphrase(passphrase);

  if (e2e.async.Result.getValue(
    this.pgpContext.searchPrivateKey(this.pgpUser)).length === 0) {
    var username = this.pgpUser.slice(0, userid.lastIndexOf('<')).trim();
    var email = this.pgpUser.slice(userid.lastIndexOf('<') + 1, -1);
    this.generateKey(username, email);
  }
  return Promise.resolve();
};

mye2e.prototype.importKeypair = function(passphrase, userid, privateKey) {
  this.pgpContext.setKeyRingPassphrase(passphrase);
  this.importKey(privateKey, passphrase);

  if (e2e.async.Result.getValue(
        this.pgpContext.searchPrivateKey(userid)).length === 0 ||
      e2e.async.Result.getValue(
        this.pgpContext.searchPublicKey(userid)).length === 0) {
    return Promise.reject(Error('Keypair does not match provided userid'));
  } else if (!userid.match(/^[^<]*\s?<[^>]*>$/)) {
    return Promise.reject(Error('Invalid userid, expected: "name <email>"'));
  } else {
    this.pgpUser = userid;
    return Promise.resolve();
  }
};

mye2e.prototype.exportKey = function() {
  var serialized = e2e.async.Result.getValue(
    this.pgpContext.searchPublicKey(this.pgpUser))[0].serialized;

  return Promise.resolve(e2e.openpgp.asciiArmor.encode(
    'PUBLIC KEY BLOCK', serialized));
};

mye2e.prototype.signEncrypt = function(data, encryptKey, sign) {
  if (typeof sign === 'undefined') {
    sign = true;
  }
  var result = e2e.async.Result.getValue(
    this.pgpContext.importKey(function (str, f) {
      f('');
    }, encryptKey));
  var keys = e2e.async.Result.getValue(
    this.pgpContext.searchPublicKey(result[0]));
  var signKey;
  if (sign) {
    signKey = e2e.async.Result.getValue(
      this.pgpContext.searchPrivateKey(this.pgpUser))[0];
  } else {
    signKey = null;
  }
  var pgp = this.pgpContext;
  return new Promise(
    function(F, R) {
      pgp.encryptSign(buf2array(data), [], keys, [], signKey).addCallback(
        function (ciphertext) {
          F(array2buf(ciphertext));
        }).addErrback(R);
    });
};

mye2e.prototype.verifyDecrypt = function(data, verifyKey) {
  if (typeof verifyKey === 'undefined') {
    verifyKey = '';
  } else {
    this.importKey(verifyKey);
  }
  var byteView = new Uint8Array(data);
  var pgp = this.pgpContext;
  return new Promise(
    function (F, R) {
      pgp.verifyDecrypt(function () {
        return '';
      }, e2e.openpgp.asciiArmor.encode('MESSAGE', byteView)).addCallback(
        function (r) {
          var signed = null;
          if (verifyKey) {
            signed = r.verify.success[0].uids;
          }
          F({
            data: array2buf(r.decrypt.data),
            signedBy: signed
          });
        }).addErrback(R);
    });
};

mye2e.prototype.armor = function(data, type) {
  if (typeof type === 'undefined') {
    type = 'MESSAGE';
  }
  var byteView = new Uint8Array(data);
  return Promise.resolve(e2e.openpgp.asciiArmor.encode(type, byteView));
};

mye2e.prototype.dearmor = function(data) {
  return Promise.resolve(array2buf(e2e.openpgp.asciiArmor.parse(data).data));
};


// The following methods are part of the prototype to be able to access state
// but are not part of the API and should not be exposed to the client
mye2e.prototype.generateKey = function(name, email) {
  var pgp = this.pgpContext;
  return new Promise(
    function (resolve, reject) {
      var expiration = Date.now() / 1000 + (3600 * 24 * 365);
      pgp.generateKey('ECDSA', 256, 'ECDH', 256, name, '', email, expiration).
        addCallback(function (keys) {
        if (keys.length == 2) {
          resolve();
        } else {
          reject(new Error('Failed to generate key'));
        }
      });
    });
};

mye2e.prototype.deleteKey = function(uid) {
  this.pgpContext.deleteKey(uid);
  return Promise.resolve();
};

mye2e.prototype.importKey = function(keyStr, passphrase) {
  if (typeof passphrase === 'undefined') {
    passphrase = '';
  }
  var pgp = this.pgpContext;
  return new Promise(
    function (F, R) {
      pgp.importKey(
        function (str, f) {
          f(passphrase);
        }, keyStr).addCallback(F);
    });
};

mye2e.prototype.searchPrivateKey = function(uid) {
  var pgp = this.pgpContext;
  return new Promise(
    function (F, R) {
      pgp.searchPrivateKey(uid).addCallback(F);
    });
};

mye2e.prototype.searchPublicKey = function(uid) {
  var pgp = this.pgpContext;
  return new Promise(
    function (F, R) {
      pgp.searchPublicKey(uid).addCallback(F);
    });
};


// Helper methods (that don't need state and could be moved elsewhere)
function array2str(a) {
  var str = '';
  for (var i = 0; i < a.length; i++) {
    str += String.fromCharCode(a[i]);
  }
  return str;
}

function str2buf(s) {
  var buf = new ArrayBuffer(s.length * 2);
  var view = new Uint16Array(buf);
  for (var i = 0; i < s.length; i++) {
    view[i] = s.charCodeAt(i);
  }
  return buf;
}

function array2buf(a) {
  var buf = new ArrayBuffer(a.length);
  var byteView = new Uint8Array(buf);
  byteView.set(a);
  return buf;
}

function buf2array(b) {
  var dataView = new DataView(b);
  var result = [];
  for (var i = 0; i < dataView.byteLength; i++) {
    result.push(dataView.getUint8(i));
  }
  return result;
}

if (typeof freedom !== 'undefined') {
  freedom().providePromises(mye2e);
}

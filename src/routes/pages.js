'use strict';

const path = require('path');
const express = require('express');
const router = express.Router();

const html = (file) => path.join(__dirname, '../../public/html', file);

router.get('/',             (req, res) => res.sendFile(html('index.html')));
router.get('/call-request', (req, res) => res.sendFile(html('call-request.html')));
router.get('/video-call',   (req, res) => res.sendFile(html('video-call.html')));
router.get('/admin',        (req, res) => res.sendFile(html('admin.html')));
router.get('/login',        (req, res) => res.sendFile(html('login.html')));
router.get('/blocked',      (req, res) => res.sendFile(html('blocked.html')));
router.get('/join/:token',  (req, res) => res.sendFile(html('join.html')));

module.exports = router;

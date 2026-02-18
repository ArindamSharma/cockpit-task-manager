/*
 * SPDX-License-Identifier: LGPL-2.1-or-later
 *
 * Copyright (C) 2017 Red Hat, Inc.
 */

import React from 'react';
import { createRoot } from 'react-dom/client';

import "cockpit-dark-theme";

import { TaskManager } from './task-manager';

import "patternfly/patternfly-6-cockpit.scss";
import './task-manager.scss';

document.addEventListener("DOMContentLoaded", () => {
    createRoot(document.getElementById("task-manager")!).render(<TaskManager />);
});

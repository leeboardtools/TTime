/* 
 * To change this license header, choose License Headers in Project Properties.
 * To change this template file, choose Tools | Templates
 * and open the template in the editor.
 */

/* global fetch, Promise, Symbol */

'use strict';


//
// TODO: Add stop selection:
//  Want a list of stops (filter by geo location?)
//  For each stop, will need the list of routes + direction (maybe even end point?)
//
//  Maybe also be able to filter routes from the stop.
//
// Or maybe the other way around, pick a route (with direction)
// then pick the stops of interest?
// Could then add a name to the stop ids/routes, and store away.

var activeStopIds = [];

// These are the routes predicted to depart the active stops.
//  {
//      'route':
//      'departTime':
//      'stopId':
//      'directionId':  0 or 1
//      'directionName':
//  }
var routeEntries = [];

var lastPredictionUpdateTime;

// Information about particular stops.
//  key: stopId
//  value: {
//      name:
//      routes: Map {
//          key: route
//          value: {
//              arriveTimes: Set
//              departTimes: Set
//          }
//      }
//  }
var stopEntries = new Map();

// Information about particular routes.
//  key: route
//  value: {
//      directions: [
//              {
//                  name:
//                  routeType:
//                  routeTypeId:    // 0 - light rail, 1 - heavy rail, 2 - commuter rail, 3 - bus, 4 - ferry
//                  longName:
//                  shortName:
//                  
//                  stopIds: Set 
//                  trips: Map({
//                      key: tripId
//                      value: {
//                          stopIds: []
//                      }
//                  }
//              },
//              ...
//          ]
//      }
var routeInfoEntries = new Map();

// The route id currently selected in the route drop down list for editing.
var editRouteId = null;
var editDirection = null;
var editStopId = null;


var stopWatches = [];
var activeStopWatch = null;


function setActiveStopIds(stops) {
    if (stops.toString() !== activeStopIds.toString()){
        activeStopIds = stops;
        //stopEntries.clear();
        
        var storage = window.localStorage;
        if (storage) {
            try {
                storage.setItem('activeStopIds', activeStopIds.toString());
            } catch(e) {
                
            }
        }
    }
}

function isIterable(obj) {
    if (!obj) {
        return false;
    }
    return typeof obj[Symbol.iterator] === 'function';
}

function editRouteInfoEntry(routeId) {
    let routeInfoEntry = routeInfoEntries.get(routeId);
    if (!routeInfoEntry) {
        routeInfoEntry = {
            directions: [],
            tripIds: new Map(),
            //stopIds: new Set()
        };
        routeInfoEntries.set(routeId, routeInfoEntry);
    }
    
    return routeInfoEntry;
}


function editTripInfoEntry(routeInfoEntry, tripId) {
    var tripInfoEntry = routeInfoEntry.tripIds.get(tripId);
    if (!tripInfoEntry) {
        tripInfoEntry = {
            stopIds: []
        };
        routeInfoEntry.tripIds.set(tripId, tripInfoEntry);
    }
    
    return tripInfoEntry;
}


/**
 * Fetches routeInfoEntries with all the route ids and the basic route information (no trips, schedules, etc.)
 * @returns {Promise}
 */
function fetchRoutes() {
    var path = 'https://api-v3.mbta.com/routes';
    
    return fetch(path)
        .then(function(response) {
            return response.json();
        })
        .then(function(myJson) {
            processRoutesResponse(myJson);
        });
}

/**
 * Handles the actual processing of the route JSON results.
 * @param {Object} myJson
 * @returns {undefined}
 */
function processRoutesResponse(myJson) {
    var data = myJson.data;
    
    for (let routeData of data) {
        let routeId = routeData.id;
        
        let routeInfoEntry = editRouteInfoEntry(routeId);
        
        routeInfoEntry.routeId = routeId;
        routeInfoEntry.routeType = routeData.attributes.type;
        routeInfoEntry.routeTypeName = routeData.attributes.description;
        routeInfoEntry.longName = routeData.attributes.long_name;
        routeInfoEntry.shortName = routeData.attributes.short_name;
        
        for (let i = 0; i < routeData.attributes.direction_names.length; ++i) {
            if (!routeInfoEntry.directions[i]) {
                routeInfoEntry.directions[i] = {
                    stopIds: new Set(),
                    trips: new Map(),
                };
            }
            routeInfoEntry.directions[i].name = routeData.attributes.direction_names[i];
        }
    }
    
    console.log("processRoutesResponse()");
}


/**
 * Populates the stopIds of a routeInfoEntry for a given routeId+direction.
 * @param {String} routeId  The route id.
 * @param {Number} direction    The direction to load.
 * @returns {Promise}
 */
function fetchRouteStops(routeId, direction) {
    var path = 'https://api-v3.mbta.com/schedules?sort=stop_sequence&filter%5Bdirection_id%5D=' + direction 
            + '&filter%5Broute%5D=' + routeId;
    
    return fetch(path)
        .then(function(response) {
            return response.json();
        })
        .then(function(myJson) {
            processScheduleResponse(myJson, routeId, direction);
        });
}

/**
 * Handles the processing of the JSON results from the fetchRouteStops() call.
 * @param {String} json
 * @param {String} routeId
 * @param {Number} direction
 * @returns {undefined}
 */
function processScheduleResponse(json, routeId, direction) {
    var data = json.data;
    
    for (let stop of data) {
        let tripId = stop.relationships.trip.data.id;
        let stopId = stop.relationships.stop.data.id;

        let routeInfoEntry = editRouteInfoEntry(routeId);
        routeInfoEntry.directions[direction].stopIds.add(stopId);
        
        let tripInfoEntry = editTripInfoEntry(routeInfoEntry, tripId);
        tripInfoEntry.stopIds[stop.attributes.stop_sequence] = stopId;
    }
    
    console.log("processScheduleResponse()");
}


/**
 * Fetches the stop information for one or more stops into stopEntries.
 * @param {String | String[]} stopIds
 * @returns {Promise}
 */
function fetchStops(stopIds) {
    var path = 'https://api-v3.mbta.com/stops?filter%5Bid%5D=';
    if (isIterable(stopIds)) {
        var separator = '';
        for (let stopId of stopIds) {
            path += separator + stopId;
            separator = '%2C';
        }
    }
    else {
        // Presume it's a single value
        path += stopIds;
    }
    
    return fetch(path)
            .then(function(response) {
                return response.json();
            })
            .then(function(myJson) {
                processStopResult(myJson);
            });
}


/**
 * Fetches the schedule times and routes in stopEntries for a given stop id.
 * @param {String} stopId
 * @returns {Promise}
 */
function fetchStopRouteSchedules(stopId) {
    var path = 'https://api-v3.mbta.com/schedules?filter%5Bstop%5D=' + stopId;
    
    var result = fetch(path)
        .then(function(response) {
            return response.json();
        })
        .then(function(myJson) {
            processStopRouteSchedulesResult(myJson);
        });
        
        
    if (!stopEntries.get(stopId)) {
        var path = 'https://api-v3.mbta.com/stops/' + stopId;
        var promise = fetch(path)
                .then(function(response) {
                    return response.json();
                })
                .then(function(myJson) {
                    processStopResult(myJson);
                });
        result = Promise.all([result, promise]);
    }
    
    return result;
}

/**
 * Handles processing the JSON result for a given /stops/stopId, updating the stop entry
 * in stopEntries.
 * @param {String} json
 * @returns {undefined}
 */
function processStopResult(json) {
    var data = json.data;
    if (Array.isArray(data)) {
        for (let i = 0; i < data.length; ++i) {
            processStopData(data[i]);
        }
    }
    else {
        processStopData(data);
    }
}

function processStopData(data) {
    var stopId = data.id;
    var name = data.attributes.name;
    
    var stopEntry = stopEntries.get(stopId);
    if (!stopEntry) {
        stopEntry = {
            name: name,
            routes: new Map()
        };
        stopEntries.set(stopId, stopEntry);
    }

    stopEntry.name = name;
    
    console.log('processStopResult()');
}

/**
 * Handles processing the JSON result for a given /schedules?filter[stop]=stopId&filter[route]=routeId...
 * @param {String} json
 * @returns {undefined}
 */
function processStopRouteSchedulesResult(json) {
    var data = json.data;
    for (let item of data) {
        var stopId = item.relationships.stop.data.id;
        var route = item.relationships.route.data.id;
        
        var arrivalTimeStamp = new Date(item.attributes.arrival_time);
        var departureTimeStamp = new Date(item.attributes.departure_time);
        
        var stopEntry = stopEntries.get(stopId);
        if (!stopEntry) {
            stopEntry = {
                name: undefined,
                routes: new Map()
            };
            stopEntries.set(stopId, stopEntry);
        }
        
        var routeEntry = stopEntry.routes.get(route);
        if (!routeEntry) {
            routeEntry = {
                'arriveTimes': new Set(),
                'departTimes': new Set()
            };
            stopEntry.routes.set(route, routeEntry);
        }
        
        routeEntry.arriveTimes.add(arrivalTimeStamp);
        routeEntry.departTimes.add(departureTimeStamp);
    }
    
    console.log('processStopRouteSchedulesResult()');
}


/**
 * Fetches the stop prediction information for the activeStopIds.
 * @returns {Promise}
 */
function fetchActiveStopsPredictions() {
    var path = 'https://api-v3.mbta.com/predictions?sort=departure_time&filter%5Bstop%5D=';
    for (let i = 0; i < activeStopIds.length; ++i) {
        if (i > 0) {
            path += '%2C';
        }
        path += activeStopIds[i];
    }
    
    return fetch(path)
        .then(function(response) {
            return response.json();
        })
        .then(function(myJson) {
            return processPredictionResult(myJson);
        });
}

/**
 * Handles processing the JSON result for the prediction information of the activeStopIds.
 * @param {String} json
 * @returns {Promise}
 */
function processPredictionResult(json) {
    var entries = [];
    var firstStops = new Map();
    var predictionIds = new Set();
    
    var stopSchedulesToGet = new Set();
    
    // Gather up the routes and their departure times.
    var data = json.data;
    for (let item of data) {
        if (predictionIds.has(item.id)) {
            continue;
        }
        predictionIds.add(item.id);
        
        var time = item.attributes.departure_time;
        if (!time) {
            continue;
        }
        
        var timeStamp = new Date(time);        
        var route = item.relationships.route.data.id;
        if (!route) {
            continue;
        }
        
        var stopId = item.relationships.stop.data.id;
        var firstStop = firstStops.get(route);
        if (firstStop !== undefined) {
            if (firstStop !== stopId) {
                continue;
            }
        }
        else {
            firstStops.set(route, stopId);
        }
        
        entries.push({ 
            'route': route,
            'time': timeStamp,
            'stopId': stopId,
            'directionId': item.attributes.direction_id
        });
        
        var stopEntry = stopEntries.get(stopId);
        if (!stopEntry || !stopEntry.routes.has(route)) {
	    stopSchedulesToGet.add(stopId);
        }
    }
    
    var promises = [];
    stopSchedulesToGet.forEach(function(value) {
        let promise = fetchStopRouteSchedules(value);
        promises.push(promise);
    });
    
    routeEntries = entries;
    lastPredictionUpdateTime = new Date();
    
    console.log('processPredictionResult');
    
    return Promise.all(promises);
}


/**
 * Reloads the route table.
 * @param {String} callContext  Debugging message.
 * @returns {undefined}
 */
function updateRouteTable(callContext) {
    if (callContext) {
        console.log("updateRouteTable() from " + callContext);
    }
    
    var tableElement = document.getElementById('busList');
    while (tableElement.rows.length > 1) {
        tableElement.deleteRow(-1);
    }
    
    // TODO: Add a spacer row every 30 minutes.
    
    for (let entry of routeEntries) {
        let row = tableElement.insertRow();
        let busCell = row.insertCell();
        let timeCell = row.insertCell();
        let scheduledTimeCell = row.insertCell();
        let stopCell = row.insertCell();

        busCell.innerHTML = entry.route;
        timeCell.innerHTML = dateToHHMMString(entry.time);
        
        var stopName = entry.stopId;
        var stopEntry = stopEntries.get(entry.stopId);
        if (stopEntry) {
            var routeEntry = stopEntry.routes.get(entry.route);
            if (routeEntry && routeEntry.departTimes.size > 0) {
                var departTimes = new Array();
                routeEntry.departTimes.forEach(function(value) {
                    departTimes.push(value);
                });
                departTimes.sort();
                
                var minDelta = Math.abs(departTimes[0].valueOf() - entry.time);
                var minIndex = 0;
                for (let i = 1; i < departTimes.length; ++i) {
                    var delta = Math.abs(departTimes[i].valueOf() - entry.time);
                    if (delta < minDelta) {
                        minDelta = delta;
                        minIndex = i;
                    }
                }
                
                scheduledTimeCell.innerHTML = dateToHHMMString(departTimes[minIndex]);
            }
            
            if (stopEntry.name) {
                stopName = stopEntry.name;
            }
        }
        
        var routeInfoEntry = routeInfoEntries.get(entry.route);
        if (routeInfoEntry) {
            if ((entry.directionId >= 0) && (entry.directionId < routeInfoEntry.directions.length)) {
                busCell.innerHTML += ' ' + routeInfoEntry.directions[entry.directionId].name;
            }
        }
        
        stopCell.innerHTML = stopName;
    }
    
    var lastUpdateTimeElement = document.getElementById('lastUpdateTime');
    lastUpdateTimeElement.innerHTML = dateToHHMMString(lastPredictionUpdateTime, true);
}


function dateToHHMMString(time, includeSeconds) {
    if (!time) {
        return '';
    }
    var hours = time.getHours();
    var suffix = " AM";
    if (hours > 12) {
        hours -= 12;
        suffix = " PM";
    }
    hours = hours.toString();
    if (hours.length === 1) {
        hours = " " + hours;
    }

    var minutes = time.getMinutes().toString();
    if (minutes.length === 1) {
        minutes = "0" + minutes;
    }
    
    var seconds = "";
    if (includeSeconds) {
        seconds = time.getSeconds().toString();
        if (seconds.length === 1) {
            seconds = "0" + seconds;
        }
        seconds = ":" + seconds;
    }
    
    return hours + ':' + minutes + seconds + suffix;
}

function onUpdateBtn() {
    fetchActiveStopsPredictions().then(() => updateRouteTable("fetchActiveStopsPredictions()"));
}

function dropDownClick(elementId) {
    var dropDownElement = document.getElementById(elementId);
    closeDropDowns(dropDownElement);
    dropDownElement.classList.toggle('show');
}

function removeAllChildren(element) {
    while (element.firstChild) {
        element.removeChild(element.firstChild);
    }
}

function hideDropDownList(dropDownListElement) {
    if (dropDownListElement.classList.contains('show')) {
        dropDownListElement.classList.remove('show');
    }
}

function closeDropDowns(except) {
    var dropdowns = document.getElementsByClassName('dropdown-content');
    for (var i = 0; i < dropdowns.length; ++i) { 
        if (dropdowns[i] !== except) {
            hideDropDownList(dropdowns[i]); 
        }
    }
}

function showElement(element, show) {
    if (show) {
        if (element.classList.contains('hide')) {
            element.classList.remove('hide');
        }
    }
    else {
        element.classList.add('hide');
    }
}

function elementOrParentMatches(element, selector) {
    return element && (element.matches(selector) || elementOrParentMatches(element.parentElement, selector));
}

function addCheckboxItem(parent, id, text, isChecked) {
    var container = document.createElement('label');
    container.classList.add('checkboxcontainer');
    container.id = id;
    container.innerHTML = text;

    var input = document.createElement('input');
    input.type = 'checkbox';
    input.id = '_input_' + id;
    if (isChecked) {
        input.checked = 'checked';
    }
    container.appendChild(input);
    
    var span = document.createElement('span');
    span.classList.add('checkmark');
    container.appendChild(span);

    parent.appendChild(container);
    
    // This stops the onclick from going up the parent chain and triggering the main
    // window.onclick, which closes the drop downs (we don't want the drop down to close
    // just when a checkbox item is toggled.
    container.onclick = function(event) {
        event.stopPropagation();
    };
}

function isCheckboxItemChecked(id) {
    var element = document.getElementById('_input_' + id);
    return element && element.checked;
}


/**
 * Populates the route selection drop-down list.
 * @returns {undefined}
 */
function setupRouteDropDown() {
    var dropDownListElement = document.getElementById('routeDropDownList');
    removeAllChildren(dropDownListElement);
    
    var buttonElement = document.getElementById('routeDropDownBtn');
    buttonElement.innerHTML = "Route";
    
    routeInfoEntries.forEach(function(routeInfoEntry, routeId) {
        let element = document.createElement('p');
        
        element.innerHTML = routeId;
        element.onclick = function() {
            hideDropDownList(dropDownListElement);
            editRouteId = routeId;
            
            buttonElement.innerHTML = routeId;
            
            setupDirectionDropDown();
        };
        
        dropDownListElement.appendChild(element);
    });
    
    showElement(document.getElementById('routeDropDown'), true);
    
    showElement(document.getElementById('directionDropDown'), false);
    showElement(document.getElementById('stopDropDown'), false);
    showElement(document.getElementById('stopRoutesDropDown'), false);
    showElement(document.getElementById('addStopEntry'), false);
}

function setupDirectionDropDown() {
    var dropDownListElement = document.getElementById('directionDropDownList');
    removeAllChildren(dropDownListElement);
    
    var buttonElement = document.getElementById('directionDropDownBtn');
    buttonElement.innerHTML = "Direction";

    var routeInfoEntry = routeInfoEntries.get(editRouteId);
    if (routeInfoEntry) {
        var directions = routeInfoEntry.directions;
        for (let direction = 0; direction < directions.length; ++direction) {
            let directionEntry = directions[direction];

            let element = document.createElement('p');
            element.innerHTML = directionEntry.name;
            
            element.onclick = function() {
                hideDropDownList(dropDownListElement);
                editDirection = direction;
                
                buttonElement.innerHTML = directionEntry.name;
                
                if (!directionEntry.stopIds.size) {
                    fetchRouteStops(editRouteId, editDirection).then(() => setupStopDropDown());
                }
                else {
                    setupStopDropDown();
                }
            };
           
            if (direction === editDirection) {
                element.classList.add('checked');
                buttonElement.innerHTML = directionEntry.name;
            	element.onclick();
            }
            
            dropDownListElement.appendChild(element);
        }
    }
    
    showElement(document.getElementById('directionDropDown'), true);

    showElement(document.getElementById('stopDropDown'), false);
    showElement(document.getElementById('stopRoutesDropDown'), false);
    showElement(document.getElementById('addStopEntry'), false);
}


function setupStopDropDown() {
    var dropDownListElement = document.getElementById('stopDropDownList');
    removeAllChildren(dropDownListElement);

    var routeInfoEntry = routeInfoEntries.get(editRouteId);
    if (!routeInfoEntry) {
        return;
    }
    
    var directionEntry = routeInfoEntry.directions[editDirection];
    if (!directionEntry) {
        return;
    }
    
    var stopIds = directionEntry.stopIds;
    if (!stopIds || !stopIds.size) {
        return;
    }

    var buttonElement = document.getElementById('stopDropDownBtn');
    buttonElement.innerHTML = "Stop";
    
    fetchStops(stopIds).then(function() {
        for (let stopId of stopIds) {
            let stopEntry = stopEntries.get(stopId);
            if (!stopEntry || !stopEntry.name) {
                continue;
            }
            
            let element = document.createElement('p');
            element.innerHTML = stopEntry.name;
            
            element.onclick = function() {
                hideDropDownList(dropDownListElement);
                editStopId = stopId;
                
                buttonElement.innerHTML = stopEntry.name;

                if (!stopEntry.routes || (stopEntry.routes.size === 0)) {
                    fetchStopRouteSchedules(stopId).then(() => setupStopRoutesDropDown());
                }
                else {
                    setupStopRoutesDropDown();
                }
            };
            
            if (stopId === editStopId) {
                buttonElement.innerHTML = stopEntry.name;
                element.classList.add('checked');
                element.onclick();
            }
            
            dropDownListElement.appendChild(element);
        }
    });

    showElement(document.getElementById('stopDropDown'), true);

    showElement(document.getElementById('stopRoutesDropDown'), false);
    showElement(document.getElementById('addStopEntry'), false);
}



function setupStopRoutesDropDown() {
    var dropDownListElement = document.getElementById('stopRoutesDropDownList');
    removeAllChildren(dropDownListElement);

    var routeInfoEntry = routeInfoEntries.get(editRouteId);
    if (!routeInfoEntry) {
        return;
    }
    
    var directionEntry = routeInfoEntry.directions[editDirection];
    if (!directionEntry) {
        return;
    }

    var stopEntry = stopEntries.get(editStopId);
    if (!stopEntry) {
        return;
    }
    
    stopEntry.routes.forEach(function(routeEntry, routeId) {
        addCheckboxItem(dropDownListElement, "stopItem_" + routeId, routeId, true);
    });

    showElement(document.getElementById('stopRoutesDropDown'), true);

    showElement(document.getElementById('addStopEntry'), true);
}

function getSelectedRouteIds() {
    var routeIds = [];

    var stopEntry = stopEntries.get(editStopId);
    if (stopEntry) {
        stopEntry.routes.forEach(function(routeEntry, routeId) {
            if (isCheckboxItemChecked("stopItem_" + routeId)) {
                routeIds.push(routeId);
            }
        });
    }
    
    return routeIds;
}


function onAddStopEntryBtn() {
    var routeIds = getSelectedRouteIds();
    
    console.log("Add");
    console.log("routeId:" + editRouteId);
    console.log("direciton:" + editDirection);
    console.log("stopId:" + editStopId);
    console.log("routeIds:" + routeIds);
    
}

function isStopEntryValid(stopEntry) {
    if (!stopEntry.routeIds) {
        return false;
    }
    return true;
}

function isStopWatchValid(stopWatch) {
    if (!stopWatch.stopEntries) {
        return false;
    }
    
    var isValidStopEntry = false;
    stopWatch.stopEntries.forEach(function(stopEntry) {
        if (isStopEntryValid(stopEntry)) {
            isValidStopEntry = true;
        }
    });
    if(!isValidStopEntry) {
        return false;
    }
    
    return true;
}

function setActiveStopWatch(stopWatch) {
    activeStopWatch = stopWatch;    
    if (stopWatch) {
        storage.setItem('activeStopWatch', stopWatch.name);
        
        var stopIds = [];
        stopWatch.stopEntries.forEach(function(stopEntry) {
            stopIds.push(stopEntry.stopId);
        });
        setActiveStopIds(stopIds);
    }    
}

function loadStopWatches() {
    stopWatches = [];
    var activeStopWatchName = activeStopWatch && activeStopWatch.name;
    
    var storage = window.localStorage;
    if (!storage) {
        return;
    }
    
    var name = storage.getItem('activeStopWatch');
    var list = storage.getItem('stopWatches');
    list = JSON.parse(list);
    list.forEach(function(name) {
        var entryText = storage.getItem('stopWatch_' + name);
        if (entryText) {
            try {
                var entry = JSON.parse(entryText);
                if (isStopWatchValid(entry)) {
                    entry.name = name;
                    stopWatches.push(entry);
                    if (name === activeStopWatchName) {
                        activeStopWatch = entry;
                    }
                }
            }
            catch (e) {
                console.log('Parse of ' + name + ' failed:' + e);
                console.log('Text: ' + entryText);
            }
        }
    });
    
    if (!activeStopWatch && stopWatches.length > 0) {
        activeStopWatch = stopWatches[0];
        activeStopWatchName = activeStopWatch.name;
    }

    var dropDownListElement = document.getElementById('activeStopWatchDropDownList');
    removeAllChildren(dropDownListElement);
    
    var buttonElement = document.getElementById('activeStopWatchDropDownBtn');
    buttonElement.innerHTML = "Active Stop Watch";
    
    stopWatches.forEach(function(stopWatch) {
        let element = document.createElement('p');
        
        element.innerHTML = stopWatch.name;
        element.onclick = function() {
            hideDropDownList(dropDownListElement);
            
            setActiveStopWatch(stopWatch);
            
            buttonElement.innerHTML = stopWatch.name;
        };
        
        if (stopWatch.name === activeStopWatchName) {
            element.classList.add('checked');
        }
        
        dropDownListElement.appendChild(element);
    });
    
    if (activeStopWatch) {
        setActiveStopWatch(activeStopWatch);
        buttonElement.innerHTML = activeStopWatch.name;
    }
}

function addStopWatch() {
    console.log("addStopWatch()");
}

function modifyStopWatch() {
    console.log("modifyStopWatch()");
}

function removeStopWatch() {
    console.log("removeStopWatch()");
}

// Need:
//      
// Stop Watch Selector:
//      Drop down of stop watches, with active stop watch selected.
//      Commands:
//          New Stop Watch
//          Delete Stop Watch (only if > 1 stop watch)
// 
// Stop Watch Editor:
//      Table of stop entries.
//      A stop entry consists of:
//          Route
//          Direction
//          Stop
//          RouteIds
//          Delete Button
//          
//      Last row is always the new entry.
//          Instead of Delete button, have Add button
//          
//      
// Table for stop entries.
// Edit, Delete buttons.
// Save button for saving the stop entries (stop watch)
// List of saved stop watches to choose from.
// New Stop Watch button
// Delete Stop Watch button
//
// Some rules:
// No stop watches:
// 
//  Show Edit Stops
//  
// One or more stop watches:
//  Show Stop Watch selector.
//  Show New Stop Watch Button
//  Show Delete Stop Watch Button if more than one stop watch


// Storage:
// stopWatches: {
//      key: stopWatch
// }
// 
// stopWatch: {
//  stopEntries: [
//      stopEntry
//  ]
// }
// 
// stopEntry: {
//      routeId:
//      direction:
//      stopId:
//      routeIds:   <= This is really the only one we care about.
// }
//      
// activeStopWatch: stopWatch name
    
var storage = window.localStorage;

var test = false;
//test = true;
if (test && storage) {
    let stopEntryA = [
        '{',
            '"routeId":78,',
            '"direction":1,',
            '"stopId":2158,',
            '"routeIds":[74,75,78]',
        '}'
    ].join('');
    
    let stopEntryB = [
        '{',
            '"routeId":72,',
            '"direction":1,',
            '"stopId":2159,',
            '"routeIds":[72]',
        '}'
    ].join('');
    
    let stopWatch = [
        '{',
            '"stopEntries":',
                '[',
                    stopEntryA + ',',
                    stopEntryB,
                ']',
        '}'
    ].join('');
    
    console.log(stopWatch);
    
    storage.setItem('stopWatch_Home', stopWatch);
    storage.setItem('stopWatches', '["Home"]');
    storage.setItem('activeStopWatch', 'Home');
}



window.onclick = function(event) {
    if (!elementOrParentMatches(event.target, '.dropbtn')) {
        closeDropDowns();
    }
};

/*
var url = document.URL;
var fullQueryString = url.split('?')[1];
if (fullQueryString) {
    fullQueryString = fullQueryString.split('#')[0];
    
    let queryStrings = fullQueryString.split('&');
    queryStrings.forEach(function(queryString) {
        var keyValue = queryString.split('=');
        var key = keyValue[0];
        var value = keyValue[1];
        if (key === 'stop') {
            var stops = value.split(',');
            setActiveStopIds(stops);
        }
    });
}


if (!activeStopIds.length) {
    // Do we have stops from last time?
    var storage = window.localStorage;
    if (storage) {
        var stopIds = storage.getItem('activeStopIds');
        if (stopIds) {
            stopIds = stopIds.split(',');
            setActiveStopIds(stopIds);
        }
    }
    
}
*/


loadStopWatches();


//setActiveStopIds(['2158', '2159']);

fetchRoutes()
        .then(() => updateRouteTable("fetchRoutes"))
        .then(() => setupRouteDropDown())
;

setInterval(onUpdateBtn, 60000);

onUpdateBtn();

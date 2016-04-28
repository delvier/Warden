﻿var dashboard = (function() {

    var organizationId = "";
    var wardenName = "";
    var wardenId = "";
    var apiKey = "";
    var refreshStatsIntervalSeconds = 0;
    var totalWatchers = 0;
    var viewModel = null;

    var init = function(options) {
        organizationId = options.organizationId || "";
        wardenName = options.wardenName || "";
        wardenId = options.wardenId || "";
        apiKey = options.apiKey || "";
        totalWatchers = options.totalWatchers || 0;
        refreshStatsIntervalSeconds = options.refreshStatsIntervalSeconds || 60;

        viewModel = new ViewModel();
        ko.applyBindings(viewModel);
        initWardenHub();
    };

    function ViewModel() {
        var self = this;
        var currentWardenCheckResults = [];
        var mainChartContext = $("#main-chart")[0].getContext("2d");
        var watchersChartContext = $("#watchers-chart")[0].getContext("2d");
        var mainChart = null;
        var watchersChart = null;

        self.organizations = ko.observableArray([createEmptyOrganization()]);
        self.selectedOrganization = ko.observable();
        self.selectedWarden = ko.observable();
        self.selectedOrganization.subscribe(function(organization) {
        });
        self.selectedWarden.subscribe(function(warden) {
            $('select').material_select();
        });

        self.totalUptime = ko.observable(0);
        self.totalUptimeFormatted = ko.computed(function() {
            return self.totalUptime().toFixed(2) + "%";
        });
        self.totalDowntime = ko.observable(0);
        self.totalDowntimeFormatted = ko.computed(function() {
            return self.totalDowntime().toFixed(2) + "%";
        });
        self.validResources = ko.observable(0);
        self.invalidResources = ko.observable(0);
        self.totalResourcesFormatted = ko.computed(function() {
            return self.validResources() + " of " + self.invalidResources() + " watcher(s) returned valid result(s).";
        });
        self.latestCheckAt = ko.observable("---");
        self.latestCheckAtFormatted = ko.computed(function() {
            return self.latestCheckAt();
        });

        self.failingResources = ko.observableArray([]);
        self.mostFailingResources = ko.computed(function() {
            var failingResources = self.failingResources()
                .filter(function(resource) {
                    return resource.totalDowntime() > 0;
                });
            return failingResources.slice(0, 3);
        });
        self.iterations = ko.observableArray([]);
        self.selectedWardenCheckResult = ko.observable(new WardenCheckResult(createEmptyWardenCheckResult()));
        self.totalValidIterations = ko.observable(0);
        self.totalInvalidIterations = ko.observable(0);
        self.totalIterations = ko.computed(function() {
            return self.totalValidIterations() + self.totalInvalidIterations();
        });

        self.totalIterationsFormatted = ko.computed(function() {

            var validIterations = self.totalValidIterations();
            var invalidIterations = self.totalInvalidIterations();
            var totalIterations = self.totalIterations();

            return totalIterations +
                " (" +
                validIterations +
                " valid, " +
                invalidIterations +
                " invalid).";
        });

        self.setIterationDetails = function(iteration) {
            self.latestCheckAt(iteration.completedAt);
            updateResourcesInfo(iteration);
            updateCharts(iteration);
        };

        function setStats(stats) {
            self.totalUptime(stats.totalUptime);
            self.totalDowntime(stats.totalDowntime);
            self.totalValidIterations(stats.totalValidIterations);
            self.totalInvalidIterations(stats.totalInvalidIterations);
            self.failingResources([]);
            stats.watchers.forEach(function(watcher) {
                var watcherStats = new WatcherItem(watcher);
                self.failingResources.push(watcherStats);
            });

            self.failingResources.sort(function(left, right) { return left.totalDowntime() < right.totalDowntime() });
        };

        self.changeWarden = function() {
            var selectedOrganizationId = self.selectedOrganization().id();
            var selectedWardenId = self.selectedWarden().id();
            window.location = "/dashboards/organizations/" + selectedOrganizationId + "/wardens/" + selectedWardenId;
        };

        function updateResourcesInfo(iteration) {
            var validResults = iteration.results.filter(function(result) {
                return result.isValid;
            });

            self.validResources(validResults.length);
            self.invalidResources(iteration.results.length);
        }

        function setDefaultWarden() {
            self.organizations.remove(function(organization) {
                return organization.name() === "";
            });

            var selectedOrganization = self.organizations()
                .filter(function(organization) {
                    return organization.id() === organizationId;
                })[0];

            var selectedWarden = selectedOrganization.wardens()
                .filter(function(warden) {
                    return warden.name() === wardenName;
                })[0];
            self.selectedOrganization(selectedOrganization);
            self.selectedWarden(selectedWarden);
        };

        //TODO: Push from server side.
        function refreshStats() {
            getStats()
                .then(function(stats) {
                    setStats(stats);
                    setTimeout(refreshStats, refreshStatsIntervalSeconds * 1000);
                });
        };

        refreshStats();

        getOrganizations()
            .then(function(organizations) {
                organizations.forEach(function(organization) {
                    self.organizations.push(new Organization(organization));
                });
                setDefaultWarden();
                $('select').material_select();
            });

        getIterations()
            .then(function(iterations) {
                if (iterations.length === 0) {
                    renderEmptyMainChart();
                    renderEmptyWatchersChart();

                    return;
                }

                var latestIteration = iterations[0];
                self.iterations(iterations);
                renderMainChart();
                renderWatchersChart(latestIteration);
                self.setIterationDetails(latestIteration);
            });

        function updateCharts(iteration) {
            var removeFirstIteration = self.iterations().length >= 10;
            addNewIterationToMainChart(iteration, removeFirstIteration);
            renderWatchersChart(iteration);
        };

        function renderEmptyMainChart() {
            var data = {
                labels: [],
                datasets: [
                    {
                        label: "Warden",
                        fillColor: "rgba(91, 187, 22, 0.2)",
                        strokeColor: "rgba(220,220,220,1)",
                        pointColor: "rgba(220,220,220,1)",
                        pointStrokeColor: "#fff",
                        pointHighlightFill: "#fff",
                        pointHighlightStroke: "rgba(220,220,220,1)",
                        data: [0]
                    }
                ]
            };

            var options = {
                responsive: true
            };
            mainChart = new Chart(mainChartContext).Line(data, options);
        };

        function addNewIterationToMainChart(iteration, removeFirstIteration) {
            var validResults = iteration.results.filter(function(result) {
                return result.isValid;
            });
            var point = validResults.length;
            var label = iteration.completedAt;
            if (removeFirstIteration) {
                mainChart.removeData();
            }
            mainChart.addData([point], label);
        };

        function renderMainChart() {
            var labels = [];
            var points = [];
            self.iterations()
                .forEach(function(iteration) {
                    labels.push(iteration.completedAt);
                    var validResults = iteration.results.filter(function(result) {
                        return result.isValid;
                    });
                    points.push(validResults.length);
                });

            var options = {
                scaleOverride: true,
                scaleSteps: totalWatchers,
                scaleStepWidth: 1,
                scaleStartValue: 0,
                responsive: true
            };

            var data = {
                labels,
                datasets: [
                    {
                        label: "Warden",
                        fillColor: "rgba(91, 187, 22, 0.2)",
                        strokeColor: "rgba(220,220,220,1)",
                        pointColor: "rgba(220,220,220,1)",
                        pointStrokeColor: "#fff",
                        pointHighlightFill: "#fff",
                        pointHighlightStroke: "rgba(220,220,220,1)",
                        data: points
                    }
                ]
            };

            mainChart = new Chart(mainChartContext).Line(data, options);

            $("#main-chart")
                .click(function(evt) {
                    var point = mainChart.getPointsAtEvent(evt)[0];
                    var completedAt = point.label;
                    var iteration = self.iterations()
                        .filter(function(iteration) {
                            return iteration.completedAt === completedAt;
                        })[0];
                    var url = "/organizations/" +
                        organizationId +
                        "/wardens/" +
                        wardenId +
                        "/iterations/" +
                        iteration.id;
                    window.open(url, '_blank');
                });
        };

        function renderEmptyWatchersChart() {
            var data = [];
            data.push({
                value: 1,
                color: "rgba(75, 74, 73, 0.1)",
                highlight: "rgba(75, 74, 73, 0.2)",
                label: "Missing data"
            });

            var options = {
                responsive: true
            };
            watchersChart = new Chart(watchersChartContext).Pie(data, options);
        };

        function renderWatchersChart(iteration) {
            var invalidResults = iteration.results.filter(function(result) {
                return !result.isValid;
            });
            var validResults = iteration.results.filter(function(result) {
                return result.isValid;
            });
            var data = [];
            var labels = [];
            currentWardenCheckResults = [];
            iteration.results.forEach(function(result) {
                currentWardenCheckResults.push(result);
                labels.push(result.watcherCheckResult.watcherName);
            });
            invalidResults.forEach(function(result) {
                data.push({
                    value: 1,
                    color: "rgba(247, 70, 74, 0.5)",
                    highlight: "rgba(247, 70, 74, 0.8)",
                    label: result.watcherCheckResult.watcherName
                });
            });

            validResults.forEach(function(result) {
                data.push({
                    value: 1,
                    color: "rgba(91, 187, 22, 0.5)",
                    highlight: "rgba(91, 187, 22, 0.8)",
                    label: result.watcherCheckResult.watcherName
                });
            });

            var options = {
                responsive: true
            };

            watchersChart = new Chart(watchersChartContext).Pie(data, options);

            $("#watchers-chart")
                .click(function(evt) {
                    var segment = watchersChart.getSegmentsAtEvent(evt)[0];
                    var watcherName = segment.label;
                    var wardenCheckResult = currentWardenCheckResults.filter(function(result) {
                        return result.watcherCheckResult.watcherName === watcherName;
                    })[0];
                    self.selectedWardenCheckResult(new WardenCheckResult(wardenCheckResult));
                });
        };
    };

    function createEmptyOrganization() {
        return new Organization({
            id: "",
            name: "",
            wardens: []
        });
    };

    function createEmptyWardenCheckResult() {
        return {
            completedAt: "---",
            watcherCheckResult: {
                watcherName: "---",
                watcherType: "---",
                description: "---",
                isValid: "---"
            }
        };
    };

    function Organization(organization) {
        var self = this;
        self.id = ko.observable(organization.id);
        self.name = ko.observable(organization.name);
        self.wardens = ko.observableArray([]);
        organization.wardens.forEach(function(warden) {
            self.wardens.push(new WardenItem(warden));
        });
    };

    function WardenItem(warden) {
        var self = this;
        self.id = ko.observable(warden.id);
        self.name = ko.observable(warden.name);
        self.enabled = ko.observable(warden.name);
    };

    function WatcherItem(watcher) {
        var self = this;
        self.name = ko.observable(watcher.name);
        self.type = ko.observable(watcher.type);
        self.totalDowntime = ko.observable(watcher.totalDowntime);
        self.totalUptime = ko.observable(watcher.totalUptime);
        self.url = ko.computed(function() {
            return "/organizations/" + organizationId + "/wardens/" + wardenId + "/watchers/" + self.name();
        });
        self.infoFormatted = ko.computed(function() {
            return self.name() + " (" + self.totalDowntime().toFixed(2) + "%" + ")";
        });
    };

    function WardenCheckResult(result) {
        var self = this;
        self.watcherName = ko.observable(result.watcherCheckResult.watcherName);
        self.watcherType = ko.observable(result.watcherCheckResult.watcherType);
        self.isValid = ko.observable(result.watcherCheckResult.isValid);
        self.description = ko.observable(result.watcherCheckResult.description);
        self.completedAt = ko.observable(result.completedAt);
        self.exception = ko.observable(result.exception);
        self.url = ko.computed(function() {
            return "/organizations/" + organizationId + "/wardens/" + wardenId + "/watchers/" + self.watcherName();
        });
        self.exceptionFormatted = ko.computed(function() {
            if (!self.exception())
                return "---";

            return getExceptionDetails(self.exception());
        });


        function getExceptionDetails(exception) {
            if (!exception)
                return "";

            var innerException = getExceptionDetails(exception.innerException);
            var innerExceptionMessage = "";
            if (innerException)
                innerExceptionMessage = "<br><br><hr><strong>*Inner exception*</strong><br><br>" + innerException;

            return "<strong>Source:</strong><br>" +
                exception.source +
                "<br><br><strong>Message:</strong><br>" +
                exception.message +
                "<br><br><strong>Stack trace:</strong><br>" +
                exception.stackTraceString +
                innerExceptionMessage;
        };
    };

    function getStats() {
        var endpoint = organizationId + '/wardens/' + wardenName + '/stats';
        return getDataFromApi(endpoint);
    };

    function getIterations() {
        var endpoint = organizationId + '/wardens/' + wardenName + '/iterations';

        return getDataFromApi(endpoint, { results: 10 });
    };

    function getOrganizations() {
        return getDataFromApi();
    };

    function getDataFromApi(endpoint, params) {
        return $.ajax({
            url: '/api/organizations/' + (endpoint || ""),
            headers: {
                "X-Api-Key": apiKey
            },
            method: 'GET',
            data: params,
            success: function(response) {
                return response;
            }
        });
    };

    function initWardenHub() {
        $.connection.hub.qs = { organizationId, wardenName };
        var chat = $.connection.wardenHub;
        chat.client.iterationCreated = function(iteration) {
            iteration = toCamelCase(iteration);
            viewModel.setIterationDetails(iteration);
            viewModel.iterations.push(iteration);
            if (iteration.isValid) {
                viewModel.totalValidIterations(viewModel.totalValidIterations() + 1);
            } else {
                viewModel.totalInvalidIterations(viewModel.totalInvalidIterations() + 1);
            }
        };

        $.connection.hub.start()
            .done(function() {
            });
    };

    ////SignalR camelCase JSON resolver does not seem to be working - temporary workaround.
    function toCamelCase(o) {
        var build, key, destKey, value;

        if (o instanceof Array) {
            build = [];
            for (key in o) {
                value = o[key];

                if (typeof value === "object") {
                    value = toCamelCase(value);
                }
                build.push(value);
            }
        } else {
            build = {};
            for (key in o) {
                if (o.hasOwnProperty(key)) {
                    destKey = (key.charAt(0).toLowerCase() + key.slice(1) || key).toString();
                    value = o[key];
                    if (value !== null && typeof value === "object") {
                        value = toCamelCase(value);
                    }

                    build[destKey] = value;
                }
            }
        }
        return build;
    };

    return {
        init
    };
})();
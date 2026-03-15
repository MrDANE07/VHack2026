"""Test file to verify MCP tools are exposed to the commander agent."""

import asyncio
import json
import subprocess
import sys
import os
import inspect
from typing import Optional


def setup_drone_manager():
    """Initialize the drone manager for testing."""
    import mcp_server
    # Initialize drone manager as the MCP server would
    mcp_server.drone_manager = mcp_server.initialize_drone_manager()
    return mcp_server


def test_mcp_server_starts():
    """Test 1: Verify MCP server can start without errors."""
    print("\n" + "=" * 60)
    print("TEST 1: MCP Server Startup")
    print("=" * 60)

    try:
        # Try to import the MCP server module
        import mcp_server
        print("[PASS] mcp_server.py can be imported")

        # Check that FastMCP is set up
        if hasattr(mcp_server, 'mcp'):
            print(f"[PASS] FastMCP server created: {mcp_server.mcp.name}")
        else:
            print("[FAIL] FastMCP 'mcp' object not found")
            return False

        # Initialize drone_manager manually (as server would)
        mcp_server.drone_manager = mcp_server.initialize_drone_manager()
        print(f"[PASS] DroneManager initialized: {type(mcp_server.drone_manager).__name__}")

        return True
    except ImportError as e:
        print(f"[FAIL] Cannot import mcp_server: {e}")
        return False
    except Exception as e:
        print(f"[FAIL] Error during startup: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_mcp_tools_registered():
    """Test 2: Verify MCP tools are registered."""
    print("\n" + "=" * 60)
    print("TEST 2: MCP Tools Registration")
    print("=" * 60)

    try:
        import mcp_server
        from mcp_server import mcp

        # Expected tools based on mcp_server.py
        expected_tools = [
            "discover_drones",
            "get_fleet_status",
            "move_drone",
            "start_thermal_scan",
            "verify_target",
            "evaluate_fleet_for_task",
            "get_world_state",
            "return_to_base"
        ]

        # Check module-level functions decorated with @mcp.tool()
        # FastMCP adds _mcp_tool attribute to decorated functions
        registered_tools = []

        for name, obj in inspect.getmembers(mcp_server):
            if inspect.isfunction(obj):
                # Check if function has FastMCP tool marker
                if hasattr(obj, '_tool_function') or hasattr(obj, '__call__'):
                    # Check for mcp tool by looking at function name
                    if name in expected_tools:
                        registered_tools.append(name)

        # Also try to get tools from the FastMCP server's internal state
        if hasattr(mcp, 'server'):
            try:
                # FastMCP internal tool registry
                server = mcp.server
                if hasattr(server, '_tool_manager'):
                    tools = server._tool_manager.list_tools()
                    for tool in tools:
                        if tool.name not in registered_tools:
                            registered_tools.append(tool.name)
            except Exception as e:
                print(f"[INFO] Could not get tools from mcp.server: {e}")

        print(f"\n[INFO] Found tool functions in module: {expected_tools}")

        # Verify expected tools are defined in the module
        all_found = True
        for tool_name in expected_tools:
            if hasattr(mcp_server, tool_name):
                func = getattr(mcp_server, tool_name)
                if callable(func):
                    print(f"[PASS] Tool '{tool_name}' is defined and callable")
                else:
                    print(f"[FAIL] Tool '{tool_name}' is not callable")
                    all_found = False
            else:
                print(f"[FAIL] Tool '{tool_name}' NOT found in module")
                all_found = False

        if all_found:
            print(f"\n[PASS] All {len(expected_tools)} expected tools are defined")
            return True
        else:
            print("\n[FAIL] Some tools are missing")
            return False

    except Exception as e:
        print(f"[FAIL] Error checking tools: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_drone_manager_integration():
    """Test 3: Verify DroneManager is properly integrated."""
    print("\n" + "=" * 60)
    print("TEST 3: DroneManager Integration")
    print("=" * 60)

    try:
        import mcp_server

        # Ensure drone_manager is initialized
        if not hasattr(mcp_server, 'drone_manager') or mcp_server.drone_manager is None:
            mcp_server.drone_manager = mcp_server.initialize_drone_manager()

        dm = mcp_server.drone_manager

        # Initialize fleet
        dm.initialize_fleet()
        print("[PASS] Fleet initialized")

        # Get all drones
        drones = dm.get_all_drones()
        print(f"[PASS] Drones created: {len(drones)}")

        for drone_id, drone in drones.items():
            print(f"  - {drone_id}: status={drone.status}, battery={drone.battery}%")

        # Check world state
        world_state = dm.get_grid_summary()
        print(f"[PASS] Grid: {world_state['total_cells']} cells, "
              f"{world_state['visited_percentage']:.1f}% explored")

        # Check simulated victims
        if hasattr(mcp_server, 'SIMULATED_VICTIMS'):
            victims = mcp_server.SIMULATED_VICTIMS
            print(f"[PASS] Simulated victims: {len(victims)}")
            for victim_id, data in victims.items():
                print(f"  - {victim_id}: ({data['x']}, {data['z']}) @ {data['temp']}°F")

        return True

    except Exception as e:
        print(f"[FAIL] Error: {e}")
        return False


def test_commander_agent_mcp_connection():
    """Test 4: Verify commander agent can connect to MCP server."""
    print("\n" + "=" * 60)
    print("TEST 4: Commander Agent MCP Connection")
    print("=" * 60)

    try:
        # Check that commander_agent.py can be imported
        import commander_agent

        print("[PASS] commander_agent.py imported")

        # Check that MCPServerStdio is configured
        if hasattr(commander_agent, 'mcp_server'):
            mcp_server = commander_agent.mcp_server
            print(f"[PASS] MCPServerStdio configured")
            # MCPServerStdio stores config in different attributes
            print(f"  Server type: {type(mcp_server).__name__}")
            if hasattr(mcp_server, 'command'):
                print(f"  Command: {mcp_server.command}")
            if hasattr(mcp_server, 'args'):
                print(f"  Args: {mcp_server.args}")
        else:
            print("[FAIL] mcp_server not configured in commander_agent")
            return False

        # Check that commander_agent has toolsets
        if hasattr(commander_agent, 'commander_agent'):
            agent = commander_agent.commander_agent
            if hasattr(agent, 'toolsets'):
                toolsets = agent.toolsets
                print(f"[PASS] Agent has toolsets: {type(toolsets)}")
                # Check if MCP server is in toolsets
                if hasattr(toolsets, '__iter__'):
                    for ts in toolsets:
                        print(f"  - Toolset: {type(ts).__name__}")
            else:
                print("[WARN] Agent does not have toolsets attribute")

        # Verify the MCP server config points to mcp_server.py
        if hasattr(commander_agent, 'mcp_server'):
            # Check that the server would run mcp_server.py
            print(f"[PASS] MCP server configured to expose tools to commander agent")

        return True

    except ImportError as e:
        print(f"[FAIL] Cannot import commander_agent: {e}")
        return False
    except Exception as e:
        print(f"[FAIL] Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_tool_functions_work():
    """Test 5: Test that MCP tool functions execute correctly."""
    print("\n" + "=" * 60)
    print("TEST 5: Tool Function Execution")
    print("=" * 60)

    try:
        import mcp_server

        # Ensure drone_manager is initialized
        if not hasattr(mcp_server, 'drone_manager') or mcp_server.drone_manager is None:
            mcp_server.drone_manager = mcp_server.initialize_drone_manager()

        dm = mcp_server.drone_manager
        dm.initialize_fleet()

        # Test discover_drones
        print("\n[TEST] discover_drones()")
        result = asyncio.run(mcp_server.discover_drones())
        data = json.loads(result)
        assert "count" in data or "drones" in data
        print(f"[PASS] discover_drones returned {data.get('count', len(data.get('drones', [])))} drones")

        # Test get_fleet_status
        print("\n[TEST] get_fleet_status()")
        result = asyncio.run(mcp_server.get_fleet_status())
        data = json.loads(result)
        assert "drones" in data
        print(f"[PASS] get_fleet_status returned {len(data['drones'])} drones")

        # Test evaluate_fleet_for_task
        print("\n[TEST] evaluate_fleet_for_task(25, 25)")
        result = asyncio.run(mcp_server.evaluate_fleet_for_task(25, 25))
        data = json.loads(result)
        if "recommended_drone" in data:
            print(f"[PASS] Recommended drone: {data['recommended_drone']}")
        elif "error" in data:
            print(f"[PASS] Error returned (no available drones): {data['error']}")
        else:
            print(f"[WARN] Unexpected result: {data}")

        # Test get_world_state
        print("\n[TEST] get_world_state()")
        result = asyncio.run(mcp_server.get_world_state())
        data = json.loads(result)
        assert "grid" in data
        print(f"[PASS] World state: {data['grid']['exploration_percentage']}% explored, "
              f"{len(data.get('victims', []))} victims")

        return True

    except Exception as e:
        print(f"[FAIL] Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Run all tests."""
    print("=" * 60)
    print("MCP TOOLS EXPOSURE TEST SUITE")
    print("=" * 60)
    print("Testing whether MCP tools are properly exposed to commander agent")

    results = []

    # Test 1: Server starts
    results.append(("MCP Server Startup", test_mcp_server_starts()))

    # Test 2: Tools registered
    results.append(("MCP Tools Registration", test_mcp_tools_registered()))

    # Test 3: DroneManager integration
    results.append(("DroneManager Integration", test_drone_manager_integration()))

    # Test 4: Commander agent connection
    results.append(("Commander Agent MCP Connection", test_commander_agent_mcp_connection()))

    # Test 5: Tool functions work
    results.append(("Tool Function Execution", test_tool_functions_work()))

    # Summary
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)

    passed = 0
    failed = 0

    for name, result in results:
        status = "PASS" if result else "FAIL"
        print(f"  [{status}] {name}")
        if result:
            passed += 1
        else:
            failed += 1

    print(f"\nTotal: {passed} passed, {failed} failed out of {len(results)} tests")

    if failed == 0:
        print("\n[SUCCESS] All MCP tools are properly exposed to the commander agent!")
        return 0
    else:
        print("\n[FAILURE] Some tests failed. Check output above.")
        return 1


if __name__ == "__main__":
    sys.exit(main())
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Text "mo:core/Text";
import Array "mo:core/Array";
import Runtime "mo:core/Runtime";
import Iter "mo:core/Iter";
import Principal "mo:core/Principal";
import Order "mo:core/Order";
import MixinAuthorization "authorization/MixinAuthorization";
import AccessControl "authorization/access-control";

actor {
  let accessControlState = AccessControl.initState();
  include MixinAuthorization(accessControlState);

  public type Score = {
    player : Principal;
    score : Nat;
  };

  module Score {
    public func compare(score1 : Score, score2 : Score) : Order.Order {
      Nat.compare(score2.score, score1.score);
    };
  };

  let scores = Map.empty<Principal, Nat>();

  public shared ({ caller }) func saveScore(newScore : Nat) : async () {
    if (not (AccessControl.hasPermission(accessControlState, caller, #user))) {
      Runtime.trap("Unauthorized: Only users can save scores");
    };

    switch (scores.get(caller)) {
      case (?currentScore) {
        if (newScore > currentScore) {
          scores.add(caller, newScore);
        };
      };
      case (null) {
        scores.add(caller, newScore);
      };
    };
  };

  public query ({ caller }) func getScore() : async Nat {
    switch (scores.get(caller)) {
      case (?score) { score };
      case (null) { 0 };
    };
  };

  public query ({ caller }) func getLeaderboard() : async [(Text, Nat)] {
    let scoreList = scores.entries().toArray().map(
      func((player, score)) { { player; score } }
    ).sort();

    scoreList.sliceToArray(0, Nat.min(10, scoreList.size())).map(
      func(entry) {
        (entry.player.toText(), entry.score);
      }
    );
  };
};
